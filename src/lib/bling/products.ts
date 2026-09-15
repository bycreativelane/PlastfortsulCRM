import crypto from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fromCents, toCents } from '@/lib/money';

import { blingRequest, type ClientDeps } from './client';
import { BlingConnectionError, describeBlingFailure } from './errors';
import { listaDe } from './references';

/**
 * A importação de produtos do Bling — D6.
 *
 * ------------------------------------------------------------------
 * A LISTAGEM ESCONDE PRODUTO SEM ESTOQUE
 * ------------------------------------------------------------------
 *
 * `GET /produtos` filtra por saldo em estoque com padrão "positivo", e o
 * filtro só aceita zerado (0), positivo (1) ou negativo (2) — não existe
 * "todos". Sem os três, uma lona sem saldo hoje some da importação e o
 * vendedor não consegue orçá-la. São três listagens, para ativos (criterio 2)
 * e para inativos (3), somadas pelo id.
 *
 * ------------------------------------------------------------------
 * O DETALHE SÓ DO QUE MUDOU, E COM TETO POR RODADA
 * ------------------------------------------------------------------
 *
 * Peso e família só vêm no GET por id: um por produto, a 2 por segundo. Um
 * catálogo de 1.500 itens seria mais de 12 minutos — perto dos 15 em que a vez
 * do trabalho vence e outro processo poderia começar junto. Então:
 *   - só pede o detalhe do que é novo, do que mudou na listagem (resumo em
 *     `bling_list_hash`) ou do que não é lido há uma semana;
 *   - no máximo `detailBudget` por rodada; o resto fica para a próxima, e o
 *     cron volta em minutos em vez de um dia.
 *
 * ------------------------------------------------------------------
 * O QUE O CRM FAZ COM CADA PRODUTO DO BLING
 * ------------------------------------------------------------------
 *
 *   já vinculado (bling_product_id)       atualiza o que vem do Bling
 *   código igual a um produto sem vínculo  vincula e atualiza
 *   código de outro produto já vinculado   pendência (sku_linked_elsewhere)
 *   código maior que 60 caracteres         pendência (sku_too_long)
 *   sem código                             pendência (no_sku)
 *   código que ninguém tem                 cria
 *
 * Produto pai "com variações" não entra: quem se vende é a variação, que tem
 * id e código próprios.
 *
 * Um produto vinculado que sumiu das seis listagens vira inativo no CRM — só
 * quando as seis deram certo. Uma listagem que falhou no meio não pode
 * desativar metade do catálogo.
 */

type Objeto = Record<string, unknown>;

export interface BlingProduct {
  id: string;
  name: string;
  code: string | null;
  price: number | null;
  unit: string | null;
  type: 'P' | 'S' | 'N' | null;
  active: boolean;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  familyId: string | null;
}

export interface ProductImportStats {
  listed: number;
  skippedParents: number;
  unchanged: number;
  detailed: number;
  linked: number;
  created: number;
  updated: number;
  pending: number;
  deactivated: number;
  skuConflicts: number;
  writeErrors: number;
  /** Faltou orçamento de detalhe: há produtos para a próxima rodada. */
  remaining: number;
  listingComplete: boolean;
}

export interface ImportOptions {
  detailBudget?: number;
  refreshAfterDays?: number;
}

const NOME_MAXIMO = 120;
const SKU_MAXIMO = 60;
const UNIDADE_MAXIMA = 16;
const CATEGORIA_MAXIMA = 60;
const LIMITE_POR_PAGINA = 100;
const MAXIMO_DE_PAGINAS = 100;

function ehObjeto(v: unknown): v is Objeto {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function idDe(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return String(v);
  if (typeof v === 'string' && v.trim() && v.trim() !== '0') return v.trim();
  return null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function numeroNaoNegativo(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

function cortar(v: string, maximo: number): string {
  return v.length <= maximo ? v : `${v.slice(0, maximo - 1)}…`;
}

/** O resumo da listagem: muda quando algo que a listagem mostra muda. */
export function listHash(item: Objeto): string {
  const partes = [item.nome, item.codigo, item.preco, item.situacao, item.tipo, item.formato, item.idProdutoPai];
  return crypto.createHash('sha1').update(JSON.stringify(partes)).digest('hex');
}

/** Pai "com variações" sem pai próprio: não é vendável, as variações é que são. */
export function isVariationParent(item: Objeto): boolean {
  return item.formato === 'V' && !idDe(item.idProdutoPai);
}

export function productFromBling(item: Objeto, detalhe: Objeto | null): BlingProduct | null {
  const fonte = { ...item, ...(detalhe ?? {}) };
  const id = idDe(fonte.id);
  const nome = texto(fonte.nome);
  if (!id || !nome) return null;
  const tipo = fonte.tipo === 'P' || fonte.tipo === 'S' || fonte.tipo === 'N' ? fonte.tipo : null;
  const preco = numeroNaoNegativo(fonte.preco);
  const bruto = numeroNaoNegativo(fonte.pesoBruto);
  const liquido = numeroNaoNegativo(fonte.pesoLiquido);
  return {
    id,
    name: nome,
    code: texto(fonte.codigo),
    // NUMERIC(12,2): arredondado como o banco arredonda (lib/money).
    price: preco === null ? null : fromCents(toCents(preco)),
    unit: texto(fonte.unidade),
    type: tipo,
    active: fonte.situacao !== 'I',
    grossWeightKg: bruto === null ? null : Math.round(bruto * 1000) / 1000,
    netWeightKg: liquido === null ? null : Math.round(liquido * 1000) / 1000,
    familyId: ehObjeto(fonte.categoria) ? idDe(fonte.categoria.id) : null,
  };
}

interface CrmProduct {
  id: string;
  sku: string | null;
  name: string;
  active: boolean;
  bling_product_id: string | null;
  bling_synced_at: string | null;
  bling_list_hash: string | null;
}

const normalizarSku = (sku: string) => sku.trim().toLowerCase();

async function listarTudo(chamar: (q: Record<string, string | number>) => Promise<unknown>) {
  const porId = new Map<string, Objeto>();
  for (const criterio of [2, 3]) {
    for (const saldo of [0, 1, 2]) {
      for (let pagina = 1; pagina <= MAXIMO_DE_PAGINAS; pagina++) {
        const lista = listaDe(
          await chamar({ criterio, tipo: 'T', filtroSaldoEstoque: saldo, pagina, limite: LIMITE_POR_PAGINA })
        );
        for (const item of lista) {
          const id = idDe(item.id);
          if (id && !porId.has(id)) porId.set(id, item);
        }
        if (lista.length < LIMITE_POR_PAGINA) break;
        if (pagina === MAXIMO_DE_PAGINAS) throw new Error('/produtos: páginas demais');
      }
    }
  }
  return porId;
}

async function carregarProdutosDoCrm(db: SupabaseClient, accountId: string): Promise<CrmProduct[]> {
  const todos: CrmProduct[] = [];
  for (let inicio = 0; inicio < 100_000; inicio += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id, sku, name, active, bling_product_id, bling_synced_at, bling_list_hash')
      .eq('account_id', accountId)
      .order('id')
      .range(inicio, inicio + 999);
    if (error) throw Object.assign(new Error(`não consegui ler o catálogo: ${error.message}`), { code: error.code });
    todos.push(...((data ?? []) as CrmProduct[]));
    if ((data ?? []).length < 1000) break;
  }
  return todos;
}

export async function importProducts(
  db: SupabaseClient,
  conexao: { id: string; account_id: string },
  deps: ClientDeps = {},
  opcoes: ImportOptions = {}
): Promise<ProductImportStats> {
  const now = deps.now ?? Date.now;
  const orcamento = opcoes.detailBudget ?? 600;
  const renovarDias = opcoes.refreshAfterDays ?? 7;
  const stats: ProductImportStats = {
    listed: 0,
    skippedParents: 0,
    unchanged: 0,
    detailed: 0,
    linked: 0,
    created: 0,
    updated: 0,
    pending: 0,
    deactivated: 0,
    skuConflicts: 0,
    writeErrors: 0,
    remaining: 0,
    listingComplete: false,
  };

  const listados = await listarTudo((query) => blingRequest(db, conexao.id, '/produtos', { query }, deps));
  stats.listed = listados.size;
  stats.listingComplete = true;

  const { data: familias } = await db
    .from('bling_references')
    .select('bling_id, label')
    .eq('connection_id', conexao.id)
    .eq('kind', 'product_category');
  const rotuloDaFamilia = new Map(((familias ?? []) as Array<{ bling_id: string; label: string }>).map((f) => [f.bling_id, f.label]));

  const crm = await carregarProdutosDoCrm(db, conexao.account_id);
  const porBling = new Map(crm.filter((p) => p.bling_product_id).map((p) => [p.bling_product_id as string, p]));
  const porSku = new Map(crm.filter((p) => p.sku).map((p) => [normalizarSku(p.sku as string), p]));

  const agora = () => new Date(now()).toISOString();
  const renovarAntesDe = now() - renovarDias * 86_400_000;
  let restante = orcamento;

  // O que um admin mandou ignorar continua ignorado: a importação seguinte
  // regravava a pendência como 'pending' e desfazia o clique.
  const { data: ignoradas } = await db
    .from('bling_product_matches')
    .select('bling_product_id')
    .eq('connection_id', conexao.id)
    .eq('status', 'ignored');
  const idsIgnorados = new Set(((ignoradas ?? []) as Array<{ bling_product_id: string }>).map((m) => m.bling_product_id));

  const pendencia = async (
    item: Objeto,
    produto: BlingProduct | null,
    motivo: 'no_sku' | 'sku_linked_elsewhere' | 'sku_too_long',
    candidato: CrmProduct | null
  ) => {
    const idDoBling = idDe(item.id);
    if (idDoBling && idsIgnorados.has(idDoBling)) return;
    const { error } = await db.from('bling_product_matches').upsert(
      {
        account_id: conexao.account_id,
        connection_id: conexao.id,
        bling_product_id: idDe(item.id),
        bling_code: texto(item.codigo),
        bling_name: cortar(texto(item.nome) ?? '(sem nome)', 300),
        reason: motivo,
        candidate_product_id: candidato?.id ?? null,
        status: 'pending',
        payload: produto ?? {},
        updated_at: agora(),
      },
      { onConflict: 'connection_id,bling_product_id' }
    );
    if (error) stats.writeErrors++;
    else stats.pending++;
  };

  const resolverPendencia = async (blingId: string, status: 'linked' | 'created') => {
    await db
      .from('bling_product_matches')
      .update({ status, resolved_at: agora(), updated_at: agora() })
      .eq('connection_id', conexao.id)
      .eq('bling_product_id', blingId)
      .eq('status', 'pending');
  };

  /**
   * O que gravar do Bling. Sem o detalhe, SÓ o que a listagem traz (nome,
   * preço, situação, tipo): unidade, peso e família são do detalhe, e gravar
   * `null` neles apagaria o peso que um vinculado já tinha. E sem detalhe não
   * se marca `bling_synced_at` nem o resumo — a próxima rodada tenta de novo.
   */
  const camposDoBling = (produto: BlingProduct, hash: string, comDetalhe: boolean) => {
    const base = {
      name: cortar(produto.name, NOME_MAXIMO),
      price: produto.price,
      active: produto.active,
      bling_product_id: produto.id,
      bling_product_type: produto.type,
      updated_at: agora(),
    };
    if (!comDetalhe) return base;
    const familia = produto.familyId ? rotuloDaFamilia.get(produto.familyId) : undefined;
    return {
      ...base,
      unit: produto.unit ? cortar(produto.unit, UNIDADE_MAXIMA) : null,
      ...(familia ? { category: cortar(familia, CATEGORIA_MAXIMA) } : {}),
      gross_weight_kg: produto.grossWeightKg,
      net_weight_kg: produto.netWeightKg,
      bling_family_id: produto.familyId,
      bling_synced_at: agora(),
      bling_list_hash: hash,
    };
  };

  for (const [blingId, item] of listados) {
    if (isVariationParent(item)) {
      stats.skippedParents++;
      continue;
    }

    const hash = listHash(item);
    const vinculado = porBling.get(blingId);
    const lidoHaPouco =
      vinculado?.bling_synced_at && Date.parse(vinculado.bling_synced_at) >= renovarAntesDe;
    if (vinculado && vinculado.bling_list_hash === hash && lidoHaPouco) {
      stats.unchanged++;
      continue;
    }

    if (restante <= 0) {
      stats.remaining++;
      continue;
    }
    restante--;

    let detalhe: Objeto | null = null;
    try {
      [detalhe] = listaDe(await blingRequest(db, conexao.id, `/produtos/${blingId}`, {}, deps));
      stats.detailed++;
    } catch (erro) {
      if (erro instanceof BlingConnectionError) throw erro;
      // Sem detalhe, fica o que a listagem diz — sem peso e sem família, e
      // sem resumo gravado, para a próxima rodada tentar de novo.
      console.error(`[bling] detalhe do produto ${blingId} falhou:`, describeBlingFailure(erro));
    }
    const produto = productFromBling(item, detalhe);
    if (!produto) continue;
    const comDetalhe = detalhe !== null;

    if (vinculado) {
      const campos: Record<string, unknown> = camposDoBling(produto, hash, comDetalhe);
      if (produto.code && produto.code.length <= SKU_MAXIMO && produto.code !== vinculado.sku) {
        const dono = porSku.get(normalizarSku(produto.code));
        if (dono && dono.id !== vinculado.id) stats.skuConflicts++;
        else campos.sku = produto.code;
      }
      const { error } = await db.from('products').update(campos).eq('id', vinculado.id);
      if (error) stats.writeErrors++;
      else stats.updated++;
      continue;
    }

    if (!produto.code) {
      const candidato =
        crm.find((p) => !p.bling_product_id && p.name.trim().toLowerCase() === produto.name.trim().toLowerCase()) ?? null;
      await pendencia(item, produto, 'no_sku', candidato);
      continue;
    }
    if (produto.code.length > SKU_MAXIMO) {
      await pendencia(item, produto, 'sku_too_long', null);
      continue;
    }

    const doSku = porSku.get(normalizarSku(produto.code));
    if (doSku && doSku.bling_product_id && doSku.bling_product_id !== produto.id) {
      await pendencia(item, produto, 'sku_linked_elsewhere', doSku);
      continue;
    }

    if (doSku) {
      const { error } = await db.from('products').update(camposDoBling(produto, hash, comDetalhe)).eq('id', doSku.id);
      if (error) {
        stats.writeErrors++;
        continue;
      }
      stats.linked++;
      doSku.bling_product_id = produto.id;
      porBling.set(produto.id, doSku);
      await resolverPendencia(produto.id, 'linked');
      continue;
    }

    const { data: criado, error } = await db
      .from('products')
      .insert({
        account_id: conexao.account_id,
        sku: produto.code,
        currency: 'BRL',
        ...camposDoBling(produto, hash, comDetalhe),
      })
      .select('id')
      .single();
    if (error || !criado) {
      stats.writeErrors++;
      continue;
    }
    stats.created++;
    const novo: CrmProduct = {
      id: (criado as { id: string }).id,
      sku: produto.code,
      name: produto.name,
      active: produto.active,
      bling_product_id: produto.id,
      bling_synced_at: comDetalhe ? agora() : null,
      bling_list_hash: comDetalhe ? hash : null,
    };
    porBling.set(produto.id, novo);
    porSku.set(normalizarSku(produto.code), novo);
    await resolverPendencia(produto.id, 'created');
  }

  // O que sumiu do Bling — só com as seis listagens completas.
  if (stats.listingComplete) {
    for (const produto of crm) {
      if (!produto.bling_product_id || !produto.active || listados.has(produto.bling_product_id)) continue;
      const { error } = await db
        .from('products')
        .update({ active: false, updated_at: agora() })
        .eq('id', produto.id);
      if (error) stats.writeErrors++;
      else stats.deactivated++;
    }
  }

  return stats;
}
