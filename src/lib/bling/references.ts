import type { SupabaseClient } from '@supabase/supabase-js';

import { blingRequest, type ClientDeps } from './client';
import { BlingConnectionError, describeBlingFailure } from './errors';
import { foldName } from './health';

/**
 * A sincronização dos cadastros do Bling para `bling_references` (083).
 *
 * ------------------------------------------------------------------
 * O QUE O CONTRATO OBRIGA (OpenAPI conferido em 15/09/2026)
 * ------------------------------------------------------------------
 *
 * - Situações, ações e transições são POR MÓDULO. O de pedidos de venda
 *   tem id próprio em cada conta; enquanto um admin não confirmou qual é,
 *   usa-se a sugestão pelo nome só para buscar — confirmar é outra coisa.
 * - A listagem de categorias de receita NÃO traz `situacao`, mas aceita
 *   filtrar por ela: duas listas (ativas, inativas) em vez de um GET por
 *   categoria.
 * - A listagem de formas de pagamento não traz `destino` nem `condicao` —
 *   só o GET por id. São poucas; um GET cada, sob o limitador.
 * - `/depositos` devolve só os ATIVOS se não se pedir outra coisa. Pede-se
 *   ativos e inativos, para a tela conseguir dizer "está inativo".
 * - `/vendedores` filtra por padrão os contatos ativos; pede-se `T` (todos).
 * - O OpenAPI declara `data` de `/vendedores` como objeto, não lista.
 *   `listaDe` aceita os dois.
 *
 * ------------------------------------------------------------------
 * UM TIPO QUE FALHA NÃO DERRUBA OS OUTROS
 * ------------------------------------------------------------------
 *
 * Um escopo que falta no aplicativo dá 403 só naquele recurso. O relatório
 * diz qual tipo falhou e por quê, e o resto sincroniza. A exceção é a
 * CONEXÃO caída (`BlingConnectionError`): aí nada mais vai funcionar, e
 * continuar só gastaria chamadas.
 */

export const REFERENCE_KINDS = [
  'order_module',
  'order_status',
  'order_action',
  'order_transition',
  'revenue_category',
  'product_category',
  'payment_method',
  'seller',
  'warehouse',
  'contact_type',
  'logistics',
] as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export interface ReferenceRow {
  kind: ReferenceKind;
  bling_id: string;
  parent_bling_id: string | null;
  label: string;
  active: boolean;
  payload: Record<string, unknown>;
}

export type SyncReport = Partial<
  Record<ReferenceKind, { count: number; error?: { code: string; message: string } }>
>;

type Objeto = Record<string, unknown>;

const LIMITE_POR_PAGINA = 100;
const MAXIMO_DE_PAGINAS = 50;
const LOTE_DE_GRAVACAO = 500;

function ehObjeto(valor: unknown): valor is Objeto {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

/** `data` como lista, venha lista ou objeto. */
export function listaDe(body: unknown): Objeto[] {
  const data = ehObjeto(body) ? body.data : undefined;
  if (Array.isArray(data)) return data.filter(ehObjeto);
  if (ehObjeto(data)) return [data];
  return [];
}

/** O id do Bling como texto, ou nulo se não for um id utilizável. */
function idDe(valor: unknown): string | null {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) return String(valor);
  if (typeof valor === 'string' && valor.trim() && valor.trim() !== '0') return valor.trim();
  return null;
}

function textoDe(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function numeroDe(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

// ------------------------------------------------------------
// De cada resposta para linhas do cache (puras, testadas)
// ------------------------------------------------------------

export function modulesToRows(lista: Objeto[]): ReferenceRow[] {
  return lista.flatMap((m) => {
    const id = idDe(m.id);
    if (!id) return [];
    return [
      {
        kind: 'order_module' as const,
        bling_id: id,
        parent_bling_id: null,
        label: textoDe(m.descricao) ?? textoDe(m.nome) ?? `Módulo ${id}`,
        active: true,
        payload: { nome: textoDe(m.nome), descricao: textoDe(m.descricao), criarSituacoes: m.criarSituacoes === true },
      },
    ];
  });
}

export function statusesToRows(lista: Objeto[], moduleId: string): ReferenceRow[] {
  return lista.flatMap((s) => {
    const id = idDe(s.id);
    if (!id) return [];
    return [
      {
        kind: 'order_status' as const,
        bling_id: id,
        parent_bling_id: moduleId,
        label: textoDe(s.nome) ?? `Situação ${id}`,
        active: true,
        payload: { idHerdado: idDe(s.idHerdado), cor: textoDe(s.cor) },
      },
    ];
  });
}

export function actionsToRows(lista: Objeto[], moduleId: string): ReferenceRow[] {
  return lista.flatMap((a) => {
    const id = idDe(a.id);
    if (!id) return [];
    return [
      {
        kind: 'order_action' as const,
        bling_id: id,
        parent_bling_id: moduleId,
        label: textoDe(a.descricao) ?? textoDe(a.nome) ?? `Ação ${id}`,
        active: true,
        payload: { nome: textoDe(a.nome) },
      },
    ];
  });
}

export function transitionsToRows(lista: Objeto[], moduleId: string): ReferenceRow[] {
  return lista.flatMap((t) => {
    const id = idDe(t.id);
    const origem = ehObjeto(t.situacaoOrigem) ? t.situacaoOrigem : {};
    const destino = ehObjeto(t.situacaoDestino) ? t.situacaoDestino : {};
    const de = idDe(origem.id);
    const para = idDe(destino.id);
    if (!id || !de || !para) return [];
    const nomeDe = textoDe(origem.nome) ?? de;
    const nomePara = textoDe(destino.nome) ?? para;
    return [
      {
        kind: 'order_transition' as const,
        bling_id: id,
        parent_bling_id: moduleId,
        label: `${nomeDe} → ${nomePara}`,
        active: t.ativo !== false,
        payload: {
          from_id: de,
          to_id: para,
          action_ids: Array.isArray(t.acoes) ? t.acoes.map(idDe).filter((a): a is string => a !== null) : [],
        },
      },
    ];
  });
}

export function revenueCategoriesToRows(ativas: Objeto[], inativas: Objeto[]): ReferenceRow[] {
  const linha = (c: Objeto, active: boolean): ReferenceRow[] => {
    const id = idDe(c.id);
    if (!id) return [];
    return [
      {
        kind: 'revenue_category',
        bling_id: id,
        // O Bling usa 0 para "sem pai".
        parent_bling_id: idDe(c.idCategoriaPai),
        label: textoDe(c.descricao) ?? `Categoria ${id}`,
        active,
        payload: { tipo: numeroDe(c.tipo) },
      },
    ];
  };
  const vistas = new Set<string>();
  const saida: ReferenceRow[] = [];
  // Uma categoria que aparece nas duas listas (mudou entre as páginas) fica
  // com o que veio primeiro: ativa.
  for (const [lista, active] of [[ativas, true], [inativas, false]] as const) {
    for (const c of lista) {
      for (const r of linha(c, active)) {
        if (vistas.has(r.bling_id)) continue;
        vistas.add(r.bling_id);
        saida.push(r);
      }
    }
  }
  return saida;
}

export function productCategoriesToRows(lista: Objeto[]): ReferenceRow[] {
  return lista.flatMap((c) => {
    const id = idDe(c.id);
    if (!id) return [];
    const pai = ehObjeto(c.categoriaPai) ? idDe(c.categoriaPai.id) : null;
    return [
      {
        kind: 'product_category' as const,
        bling_id: id,
        parent_bling_id: pai,
        label: textoDe(c.descricao) ?? `Família ${id}`,
        active: true,
        payload: {},
      },
    ];
  });
}

export function paymentMethodsToRows(lista: Objeto[], detalhes: Map<string, Objeto>): ReferenceRow[] {
  return lista.flatMap((f) => {
    const id = idDe(f.id);
    if (!id) return [];
    const d = detalhes.get(id) ?? {};
    return [
      {
        kind: 'payment_method' as const,
        bling_id: id,
        parent_bling_id: null,
        label: textoDe(f.descricao) ?? textoDe(d.descricao) ?? `Forma ${id}`,
        active: (numeroDe(d.situacao) ?? numeroDe(f.situacao)) === 1,
        payload: {
          tipoPagamento: numeroDe(f.tipoPagamento) ?? numeroDe(d.tipoPagamento),
          // 1 Pagamentos · 2 Recebimentos · 3 os dois
          finalidade: numeroDe(f.finalidade) ?? numeroDe(d.finalidade),
          // 1 Conta a receber/pagar · 2 Ficha financeira · 3 Caixa e bancos.
          // Só vem no GET por id; nulo quando esse GET falhou.
          destino: numeroDe(d.destino),
          condicao: textoDe(d.condicao),
          utilizaDiasUteis: typeof d.utilizaDiasUteis === 'boolean' ? d.utilizaDiasUteis : null,
          padrao: numeroDe(f.padrao) ?? numeroDe(d.padrao),
        },
      },
    ];
  });
}

export function sellersToRows(lista: Objeto[]): ReferenceRow[] {
  return lista.flatMap((v) => {
    const id = idDe(v.id);
    if (!id) return [];
    const contato = ehObjeto(v.contato) ? v.contato : {};
    return [
      {
        kind: 'seller' as const,
        bling_id: id,
        parent_bling_id: null,
        label: textoDe(contato.nome) ?? `Vendedor ${id}`,
        active: contato.situacao === undefined || contato.situacao === 'A',
        payload: {
          contact_id: idDe(contato.id),
          discount_limit: numeroDe(v.descontoLimite),
          store_id: ehObjeto(v.loja) ? idDe(v.loja.id) : null,
        },
      },
    ];
  });
}

export function warehousesToRows(lista: Objeto[]): ReferenceRow[] {
  const vistas = new Set<string>();
  return lista.flatMap((d) => {
    const id = idDe(d.id);
    if (!id || vistas.has(id)) return [];
    vistas.add(id);
    return [
      {
        kind: 'warehouse' as const,
        bling_id: id,
        parent_bling_id: null,
        label: textoDe(d.descricao) ?? `Depósito ${id}`,
        active: numeroDe(d.situacao) !== 0,
        payload: { padrao: d.padrao === true, desconsiderarSaldo: d.desconsiderarSaldo === true },
      },
    ];
  });
}

export function contactTypesToRows(lista: Objeto[]): ReferenceRow[] {
  return lista.flatMap((t) => {
    const id = idDe(t.id);
    if (!id) return [];
    return [
      {
        kind: 'contact_type' as const,
        bling_id: id,
        parent_bling_id: null,
        label: textoDe(t.descricao) ?? `Tipo ${id}`,
        active: true,
        payload: {},
      },
    ];
  });
}

export function logisticsToRows(lista: Objeto[]): ReferenceRow[] {
  return lista.flatMap((l) => {
    const id = idDe(l.id);
    if (!id) return [];
    return [
      {
        kind: 'logistics' as const,
        bling_id: id,
        parent_bling_id: null,
        label: textoDe(l.descricao) ?? `Logística ${id}`,
        active: l.situacao !== 'D',
        payload: {
          tipoIntegracao: textoDe(l.tipoIntegracao),
          service_ids: Array.isArray(l.servicos)
            ? l.servicos.map((s) => (ehObjeto(s) ? idDe(s.id) : null)).filter((s): s is string => s !== null)
            : [],
        },
      },
    ];
  });
}

/** O módulo de pedidos de venda, pelo nome, para buscar enquanto ninguém confirmou. */
export function suggestOrderModule(modulos: ReferenceRow[] | null): ReferenceRow | null {
  if (!modulos) return null;
  const dobrar = (s: unknown) => (typeof s === 'string' ? foldName(s) : '');
  return (
    modulos.find((m) => dobrar(m.payload.descricao) === 'pedidos de venda') ??
    modulos.find((m) => dobrar(m.payload.nome) === 'vendas') ??
    null
  );
}

// ------------------------------------------------------------
// A sincronização
// ------------------------------------------------------------

export interface SyncConnection {
  id: string;
  account_id: string;
}

type Chamar = (path: string, query?: Record<string, string | number>) => Promise<unknown>;

async function paginar(chamar: Chamar, path: string, query: Record<string, string | number>) {
  const itens: Objeto[] = [];
  for (let pagina = 1; pagina <= MAXIMO_DE_PAGINAS; pagina++) {
    const lista = listaDe(await chamar(path, { ...query, pagina, limite: LIMITE_POR_PAGINA }));
    itens.push(...lista);
    if (lista.length < LIMITE_POR_PAGINA) return itens;
  }
  // Mais de 5.000 itens num cadastro de referência é outra coisa acontecendo:
  // melhor falhar o tipo e dizer do que marcar o resto como removido.
  throw new Error(`${path}: mais de ${MAXIMO_DE_PAGINAS} páginas`);
}

/**
 * Grava um tipo inteiro e marca o que não veio.
 *
 * `seen_at` de tudo o que chegou é o INÍCIO desta rodada, e removido é o que
 * ficou com `seen_at` anterior a ele — o mesmo instante dos dois lados. Com
 * um relógio para gravar e outro para comparar, o que acabou de chegar pode
 * parecer mais velho que a rodada e ser marcado como removido.
 */
async function gravar(
  db: SupabaseClient,
  conexao: SyncConnection,
  kind: ReferenceKind,
  linhas: ReferenceRow[],
  inicio: string,
  agora: string
) {
  for (let i = 0; i < linhas.length; i += LOTE_DE_GRAVACAO) {
    const lote = linhas.slice(i, i + LOTE_DE_GRAVACAO).map((r) => ({
      account_id: conexao.account_id,
      connection_id: conexao.id,
      kind,
      bling_id: r.bling_id,
      parent_bling_id: r.parent_bling_id,
      label: r.label,
      active: r.active,
      payload: r.payload,
      seen_at: inicio,
      removed_at: null,
      updated_at: agora,
    }));
    const { error } = await db
      .from('bling_references')
      .upsert(lote, { onConflict: 'connection_id,kind,bling_id' });
    if (error) throw new Error(`não consegui gravar ${kind}: ${error.message}`);
  }

  // O que existia e não veio: marcado, não apagado (ver a 083).
  const { error } = await db
    .from('bling_references')
    .update({ removed_at: agora, updated_at: agora })
    .eq('connection_id', conexao.id)
    .eq('kind', kind)
    .lt('seen_at', inicio)
    .is('removed_at', null);
  if (error) throw new Error(`não consegui marcar os removidos de ${kind}: ${error.message}`);
}

export async function syncReferences(
  db: SupabaseClient,
  conexao: SyncConnection,
  confirmado: { orderModuleId: string | null },
  deps: ClientDeps = {}
): Promise<SyncReport> {
  const now = deps.now ?? Date.now;
  const inicio = new Date(now()).toISOString();
  const chamar: Chamar = (path, query) => blingRequest(db, conexao.id, path, { query }, deps);
  const relatorio: SyncReport = {};

  async function tipo(kind: ReferenceKind, buscar: () => Promise<ReferenceRow[]>) {
    try {
      const linhas = await buscar();
      await gravar(db, conexao, kind, linhas, inicio, new Date(now()).toISOString());
      relatorio[kind] = { count: linhas.length };
      return linhas;
    } catch (erro) {
      if (erro instanceof BlingConnectionError) throw erro;
      relatorio[kind] = { count: 0, error: describeBlingFailure(erro) };
      return null;
    }
  }

  const modulos = await tipo('order_module', async () =>
    modulesToRows(listaDe(await chamar('/situacoes/modulos')))
  );
  const moduloId = confirmado.orderModuleId ?? suggestOrderModule(modulos)?.bling_id ?? null;

  if (moduloId) {
    await tipo('order_status', async () =>
      statusesToRows(listaDe(await chamar(`/situacoes/modulos/${moduloId}`)), moduloId)
    );
    await tipo('order_action', async () =>
      actionsToRows(listaDe(await chamar(`/situacoes/modulos/${moduloId}/acoes`)), moduloId)
    );
    await tipo('order_transition', async () =>
      transitionsToRows(listaDe(await chamar(`/situacoes/modulos/${moduloId}/transicoes`)), moduloId)
    );
  } else {
    const semModulo = { count: 0, error: { code: 'no_order_module', message: 'módulo de pedidos de venda não encontrado' } };
    relatorio.order_status = semModulo;
    relatorio.order_action = semModulo;
    relatorio.order_transition = semModulo;
  }

  await tipo('revenue_category', async () =>
    revenueCategoriesToRows(
      await paginar(chamar, '/categorias/receitas-despesas', { tipo: 0, situacao: 1 }),
      await paginar(chamar, '/categorias/receitas-despesas', { tipo: 0, situacao: 2 })
    )
  );

  await tipo('product_category', async () =>
    productCategoriesToRows(await paginar(chamar, '/categorias/produtos', {}))
  );

  await tipo('payment_method', async () => {
    const lista = await paginar(chamar, '/formas-pagamentos', {});
    const detalhes = new Map<string, Objeto>();
    for (const forma of lista) {
      const id = idDe(forma.id);
      if (!id) continue;
      const body = await chamar(`/formas-pagamentos/${id}`);
      const [detalhe] = listaDe(body);
      if (detalhe) detalhes.set(id, detalhe);
    }
    return paymentMethodsToRows(lista, detalhes);
  });

  await tipo('seller', async () =>
    sellersToRows(await paginar(chamar, '/vendedores', { situacaoContato: 'T' }))
  );

  await tipo('warehouse', async () =>
    warehousesToRows([
      ...(await paginar(chamar, '/depositos', { situacao: 1 })),
      ...(await paginar(chamar, '/depositos', { situacao: 0 })),
    ])
  );

  await tipo('contact_type', async () => contactTypesToRows(listaDe(await chamar('/contatos/tipos'))));

  await tipo('logistics', async () => logisticsToRows(await paginar(chamar, '/logisticas', {})));

  return relatorio;
}
