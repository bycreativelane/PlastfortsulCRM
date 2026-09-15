import { describe, expect, it } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import { fakeDb } from './fake-db';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';
import {
  listaDe,
  paymentMethodsToRows,
  revenueCategoriesToRows,
  sellersToRows,
  suggestOrderModule,
  syncReferences,
  transitionsToRows,
  warehousesToRows,
  modulesToRows,
} from './references';

const CONFIG = { clientId: 'id', clientSecret: 's', redirectUri: 'https://crm.example.com/cb' };
const AGORA = Date.parse('2026-09-15T12:00:00.000Z');

describe('listaDe', () => {
  it('lista, objeto (o /vendedores do OpenAPI) e lixo', () => {
    expect(listaDe({ data: [{ id: 1 }, 'x', { id: 2 }] })).toEqual([{ id: 1 }, { id: 2 }]);
    expect(listaDe({ data: { id: 7 } })).toEqual([{ id: 7 }]);
    expect(listaDe(null)).toEqual([]);
    expect(listaDe({})).toEqual([]);
  });
});

describe('normalizadores', () => {
  it('transição: rótulo "origem → destino", ações como texto, inativa respeitada', () => {
    const [t] = transitionsToRows(
      [
        {
          id: 9,
          ativo: false,
          acoes: [12, 15],
          situacaoOrigem: { id: 6, nome: 'Em aberto' },
          situacaoDestino: { id: 15, nome: 'Em andamento' },
        },
      ],
      '98765'
    );
    expect(t).toEqual({
      kind: 'order_transition',
      bling_id: '9',
      parent_bling_id: '98765',
      label: 'Em aberto → Em andamento',
      active: false,
      payload: { from_id: '6', to_id: '15', action_ids: ['12', '15'] },
    });
  });

  it('transição sem origem ou destino é descartada', () => {
    expect(transitionsToRows([{ id: 1, situacaoOrigem: { id: 6 } }], 'm')).toEqual([]);
  });

  it('categoria de receita: 0 vira sem pai, e ativa ganha de inativa repetida', () => {
    const linhas = revenueCategoriesToRows(
      [{ id: 10, idCategoriaPai: 0, descricao: 'Venda direta', tipo: 2 }],
      [
        { id: 11, idCategoriaPai: 10, descricao: 'Sacos de lixo', tipo: 2 },
        { id: 10, idCategoriaPai: 0, descricao: 'Venda direta', tipo: 2 },
      ]
    );
    expect(linhas).toEqual([
      { kind: 'revenue_category', bling_id: '10', parent_bling_id: null, label: 'Venda direta', active: true, payload: { tipo: 2 } },
      { kind: 'revenue_category', bling_id: '11', parent_bling_id: '10', label: 'Sacos de lixo', active: false, payload: { tipo: 2 } },
    ]);
  });

  it('forma de pagamento: destino e condição só do detalhe; sem detalhe, destino nulo', () => {
    const detalhes = new Map([['1', { id: 1, situacao: 1, destino: 1, condicao: '30', utilizaDiasUteis: false }]]);
    const [comDetalhe, semDetalhe] = paymentMethodsToRows(
      [
        { id: 1, descricao: 'Pagamento a prazo', situacao: 1, finalidade: 2, tipoPagamento: 15 },
        { id: 2, descricao: 'Dinheiro', situacao: 0, finalidade: 3 },
      ],
      detalhes
    );
    expect(comDetalhe.payload).toMatchObject({ destino: 1, condicao: '30', finalidade: 2, utilizaDiasUteis: false });
    expect(comDetalhe.active).toBe(true);
    expect(semDetalhe.payload.destino).toBeNull();
    expect(semDetalhe.active).toBe(false);
  });

  it('vendedor: o nome é o do contato; situação diferente de A é inativo', () => {
    const [ativo, inativo] = sellersToRows([
      { id: 5, contato: { id: 50, nome: 'Vendedora Exemplo', situacao: 'A' }, descontoLimite: 10 },
      { id: 6, contato: { id: 60, nome: 'Vendedor Antigo', situacao: 'I' } },
    ]);
    expect(ativo).toMatchObject({ bling_id: '5', label: 'Vendedora Exemplo', active: true, payload: { contact_id: '50' } });
    expect(inativo.active).toBe(false);
  });

  it('depósito repetido nas duas listas entra uma vez', () => {
    expect(
      warehousesToRows([
        { id: 1, descricao: 'Geral', situacao: 1 },
        { id: 1, descricao: 'Geral', situacao: 1 },
        { id: 2, descricao: 'Antigo', situacao: 0 },
      ]).map((d) => [d.bling_id, d.active])
    ).toEqual([
      ['1', true],
      ['2', false],
    ]);
  });

  it('módulo de pedidos: pela descrição, depois pelo nome', () => {
    const modulos = modulesToRows([
      { id: 1, nome: 'Compras', descricao: 'Pedidos de Compra' },
      { id: 2, nome: 'Vendas', descricao: 'Pedidos de Venda' },
    ]);
    expect(suggestOrderModule(modulos)?.bling_id).toBe('2');
    expect(suggestOrderModule(modulesToRows([{ id: 3, nome: 'Vendas' }]))?.bling_id).toBe('3');
    expect(suggestOrderModule([])).toBeNull();
  });
});

/** Um Bling de mentira que responde por caminho, contando as chamadas. */
function blingFalso(respostas: Record<string, unknown>, falhar: Record<string, number> = {}) {
  const chamadas: string[] = [];
  const impl: FetchLike = async (url) => {
    if (url === BLING_TOKEN_URL) throw new Error('não deveria renovar');
    const u = new URL(url);
    const caminho = u.pathname.replace('/Api/v3', '');
    const chave = `${caminho}${u.searchParams.has('situacao') ? `?situacao=${u.searchParams.get('situacao')}` : ''}`;
    chamadas.push(chave);
    if (falhar[caminho]) {
      return new Response(JSON.stringify({ error: { type: 'FORBIDDEN', description: 'insufficient_scope' } }), {
        status: falhar[caminho],
      });
    }
    const body = respostas[chave] ?? respostas[caminho] ?? { data: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { impl, chamadas };
}

const RESPOSTAS = {
  '/situacoes/modulos': { data: [{ id: 98765, nome: 'Vendas', descricao: 'Pedidos de Venda' }] },
  '/situacoes/modulos/98765': { data: [{ id: 6, nome: 'Em aberto' }, { id: 15, nome: 'Em andamento' }] },
  '/situacoes/modulos/98765/acoes': { data: [{ id: 12, nome: 'lancarContas', descricao: 'Lançar contas' }] },
  '/situacoes/modulos/98765/transicoes': {
    data: [{ id: 9, ativo: true, acoes: [12], situacaoOrigem: { id: 6, nome: 'Em aberto' }, situacaoDestino: { id: 15, nome: 'Em andamento' } }],
  },
  '/categorias/receitas-despesas?situacao=1': { data: [{ id: 10, idCategoriaPai: 0, descricao: 'Venda direta', tipo: 2 }] },
  '/categorias/receitas-despesas?situacao=2': { data: [] },
  '/formas-pagamentos': { data: [{ id: 1, descricao: 'Pagamento a prazo', situacao: 1, finalidade: 2 }] },
  '/formas-pagamentos/1': { data: { id: 1, situacao: 1, destino: 1, condicao: '30' } },
  '/contatos/tipos': { data: [{ id: 3, descricao: 'Cliente' }] },
};

function montarBanco() {
  return fakeDb({
    tables: {
      bling_connections: [
        {
          id: 'conn-1',
          account_id: 'acc-1',
          status: 'connected',
          access_token: encrypt('access'),
          access_expires_at: new Date(AGORA + 3_600_000).toISOString(),
          refresh_token: encrypt('refresh'),
          refresh_lock_until: null,
          consecutive_failures: 0,
        },
      ],
      bling_references: [],
    },
    unique: { bling_references: ['connection_id,kind,bling_id'] },
    rpcs: { bling_take_request: () => 0 },
  });
}

describe('syncReferences', () => {
  it('traz os onze tipos, com o módulo sugerido quando ninguém confirmou', async () => {
    const db = montarBanco();
    const bling = blingFalso(RESPOSTAS);

    const relatorio = await syncReferences(
      db.client,
      { id: 'conn-1', account_id: 'acc-1' },
      { orderModuleId: null },
      { config: CONFIG, fetchImpl: bling.impl, now: () => AGORA }
    );

    expect(relatorio.order_status).toEqual({ count: 2 });
    expect(relatorio.order_transition).toEqual({ count: 1 });
    expect(relatorio.payment_method).toEqual({ count: 1 });
    expect(Object.keys(relatorio).sort()).toHaveLength(11);
    // Detalhe da forma de pagamento: um GET por id.
    expect(bling.chamadas).toContain('/formas-pagamentos/1');
    // Depósitos ativos e inativos; categorias ativas e inativas.
    expect(bling.chamadas).toContain('/depositos?situacao=1');
    expect(bling.chamadas).toContain('/depositos?situacao=0');
    expect(bling.chamadas).toContain('/categorias/receitas-despesas?situacao=2');

    const forma = db.tables.bling_references.find((r) => r.kind === 'payment_method');
    expect(forma).toMatchObject({ account_id: 'acc-1', connection_id: 'conn-1', bling_id: '1', removed_at: null });
    expect((forma?.payload as Record<string, unknown>).destino).toBe(1);
  });

  it('o que não veio mais é marcado como removido, não apagado; o que voltou é desmarcado', async () => {
    const db = montarBanco();
    db.tables.bling_references.push(
      { id: 'r1', account_id: 'acc-1', connection_id: 'conn-1', kind: 'contact_type', bling_id: '99', label: 'Antigo', active: true, payload: {}, seen_at: '2026-09-01T00:00:00.000Z', removed_at: null },
      { id: 'r2', account_id: 'acc-1', connection_id: 'conn-1', kind: 'contact_type', bling_id: '3', label: 'Cliente', active: true, payload: {}, seen_at: '2026-09-01T00:00:00.000Z', removed_at: '2026-09-02T00:00:00.000Z' }
    );

    await syncReferences(db.client, { id: 'conn-1', account_id: 'acc-1' }, { orderModuleId: null }, {
      config: CONFIG,
      fetchImpl: blingFalso(RESPOSTAS).impl,
      now: () => AGORA,
    });

    const antigo = db.tables.bling_references.find((r) => r.bling_id === '99');
    const voltou = db.tables.bling_references.find((r) => r.kind === 'contact_type' && r.bling_id === '3');
    expect(antigo?.removed_at).not.toBeNull();
    expect(voltou?.removed_at).toBeNull();
    expect(db.tables.bling_references.filter((r) => r.kind === 'contact_type')).toHaveLength(2);
  });

  it('um tipo que falha (escopo que falta) não derruba os outros', async () => {
    const db = montarBanco();
    const bling = blingFalso(RESPOSTAS, { '/vendedores': 403 });

    const relatorio = await syncReferences(db.client, { id: 'conn-1', account_id: 'acc-1' }, { orderModuleId: null }, {
      config: CONFIG,
      fetchImpl: bling.impl,
      now: () => AGORA,
    });

    expect(relatorio.seller?.error?.code).toBe('FORBIDDEN');
    expect(relatorio.warehouse).toEqual({ count: 0 });
    expect(relatorio.contact_type).toEqual({ count: 1 });
  });

  it('o módulo confirmado manda, mesmo com outro sugerido', async () => {
    const db = montarBanco();
    const bling = blingFalso(RESPOSTAS);
    await syncReferences(db.client, { id: 'conn-1', account_id: 'acc-1' }, { orderModuleId: '55555' }, {
      config: CONFIG,
      fetchImpl: bling.impl,
      now: () => AGORA,
    });
    expect(bling.chamadas).toContain('/situacoes/modulos/55555');
    expect(bling.chamadas).not.toContain('/situacoes/modulos/98765');
  });

  it('sem módulo de pedidos, as situações não são buscadas e o relatório diz por quê', async () => {
    const db = montarBanco();
    const bling = blingFalso({ ...RESPOSTAS, '/situacoes/modulos': { data: [{ id: 1, nome: 'Compras' }] } });
    const relatorio = await syncReferences(db.client, { id: 'conn-1', account_id: 'acc-1' }, { orderModuleId: null }, {
      config: CONFIG,
      fetchImpl: bling.impl,
      now: () => AGORA,
    });
    expect(relatorio.order_status?.error?.code).toBe('no_order_module');
    expect(bling.chamadas.some((c) => c.startsWith('/situacoes/modulos/'))).toBe(false);
  });

  it('conexão revogada no meio: para tudo e propaga', async () => {
    const db = montarBanco();
    db.tables.bling_connections[0].status = 'revoked';
    await expect(
      syncReferences(db.client, { id: 'conn-1', account_id: 'acc-1' }, { orderModuleId: null }, {
        config: CONFIG,
        fetchImpl: blingFalso(RESPOSTAS).impl,
        now: () => AGORA,
      })
    ).rejects.toMatchObject({ code: 'revoked' });
  });
});
