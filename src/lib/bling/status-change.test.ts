import { describe, expect, it } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import { fakeDb } from './fake-db';
import type { Reference } from './health';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';
import { BlingLeaseLostError } from './errors';
import { orderSourceHash, type LoadedOrder } from './orders';
import { changeOrderStatus, receivablesSince } from './status-change';

const CONFIG = { clientId: 'id', clientSecret: 's', redirectUri: 'https://crm.example.com/cb' };
const AGORA = Date.parse('2026-09-15T12:00:00.000Z');

const SETTINGS = {
  company_id: 'emp-1',
  orders_enabled: true,
  status_open_id: '6',
  status_in_progress_id: '15',
  status_fulfilled_id: '9',
  status_canceled_id: '12',
  status_future_purchase_id: '400',
};

const ETAPAS = [
  { id: 's-andamento', name: 'Em Andamento', pipeline_id: 'p-1' },
  { id: 's-atendido', name: 'Atendido', pipeline_id: 'p-1' },
  { id: 's-perdida', name: 'Venda Perdida', pipeline_id: 'p-1' },
];

function pedido(deal: Record<string, unknown> = {}): LoadedOrder {
  const carregado: LoadedOrder = {
    deal: {
      id: 'd-1',
      account_id: 'acc-1',
      contact_id: 'c-1',
      assigned_to: null,
      pipeline_id: 'p-1',
      sale_date: '2026-09-15',
      order_status: 'em_aberto',
      bling_order_id: '5001',
      sync_version: 2,
      accounts_launched_at: null,
      stock_launched_at: null,
      ...deal,
    } as LoadedOrder['deal'],
    items: [],
    installments: [],
    contact: { id: 'c-1', bling_contact_id: '5551' },
    carrier: null,
    sellerBlingId: null,
    settings: SETTINGS as LoadedOrder['settings'],
    connection: { id: 'conn-1', account_id: 'acc-1', company_id: 'emp-1', company_name: 'Empresa', status: 'connected' },
    clientTypeId: null,
    products: new Map(),
    weightExceptionByAdmin: false,
  };
  // Sincronizado por padrão: o Bling recebeu este pedido (090).
  if (!('bling_source_hash' in deal)) carregado.deal.bling_source_hash = orderSourceHash(carregado);
  return carregado;
}

function banco() {
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
    },
    rpcs: { bling_take_request: () => 0 },
  });
}

interface Estado {
  situacao: number;
  /** A data do pedido no Bling. */
  dataPedido?: string;
  contas: Array<{ id: number; situacao: number; dataEmissao?: string; origem: { id: number; tipoOrigem: string } }>;
  /** As consultas ao Contas a Receber, com os filtros. */
  consultas?: Array<Record<string, string>>;
  consultaFalhaDepoisDeLancar?: boolean;
  estornoNaoCancela?: boolean;
  estoqueRecusa?: boolean;
  /** A transição do Bling já lança as contas sozinha. */
  transicaoLancaContas?: boolean;
  recusaPatch?: string;
  lancarContasFalhaUmaVez?: boolean;
}

function blingFalso(estado: Estado) {
  const chamadas: string[] = [];
  const impl: FetchLike = async (url, init) => {
    if (url === BLING_TOKEN_URL) throw new Error('não deveria renovar');
    const u = new URL(url);
    const caminho = u.pathname.replace('/Api/v3', '');
    const metodo = init?.method ?? 'GET';
    chamadas.push(`${metodo} ${caminho}`);

    if (caminho === '/pedidos/vendas/5001' && metodo === 'GET') {
      return new Response(JSON.stringify({ data: { id: 5001, data: estado.dataPedido, situacao: { id: estado.situacao } } }), { status: 200 });
    }
    const patch = caminho.match(/^\/pedidos\/vendas\/5001\/situacoes\/(\d+)$/);
    if (patch && metodo === 'PATCH') {
      if (estado.recusaPatch) {
        return new Response(JSON.stringify({ error: { type: 'VALIDATION_ERROR', description: estado.recusaPatch } }), { status: 400 });
      }
      estado.situacao = Number(patch[1]);
      if (estado.transicaoLancaContas && estado.situacao === 15) {
        estado.contas.push({ id: 1, situacao: 1, origem: { id: 5001, tipoOrigem: 'venda' } });
      }
      return new Response(null, { status: 204 });
    }
    if (caminho === '/contas/receber') {
      const filtros = Object.fromEntries(u.searchParams.entries());
      estado.consultas?.push(filtros);
      if (estado.consultaFalhaDepoisDeLancar && chamadas.some((c) => c.endsWith('/lancar-contas'))) {
        return new Response(JSON.stringify({ error: { type: 'SERVER_ERROR', description: 'fora' } }), { status: 503 });
      }
      // Como o Bling: a emissão antes de `dataInicial` fica de fora.
      const vistas = estado.contas.filter((c) => !c.dataEmissao || !filtros.dataInicial || c.dataEmissao >= filtros.dataInicial);
      return new Response(JSON.stringify({ data: vistas }), { status: 200 });
    }
    if (caminho === '/pedidos/vendas/5001/lancar-contas') {
      if (estado.lancarContasFalhaUmaVez) {
        estado.lancarContasFalhaUmaVez = false;
        return new Response(JSON.stringify({ error: { type: 'SERVER_ERROR', description: 'fora' } }), { status: 503 });
      }
      estado.contas.push({ id: 2, situacao: 1, origem: { id: 5001, tipoOrigem: 'venda' } });
      return new Response(null, { status: 204 });
    }
    if (caminho === '/pedidos/vendas/5001/estornar-contas') {
      if (!estado.estornoNaoCancela) for (const c of estado.contas) c.situacao = 5;
      return new Response(null, { status: 204 });
    }
    if (caminho.endsWith('/lancar-estoque') && estado.estoqueRecusa) {
      return new Response(JSON.stringify({ error: { type: 'VALIDATION_ERROR', description: 'Estoque insuficiente' } }), { status: 400 });
    }
    if (caminho.endsWith('/lancar-estoque') || caminho.endsWith('/estornar-estoque')) {
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 500 });
  };
  return { impl, chamadas };
}

const ctx = (impl: FetchLike, references: Reference[] = []) => ({
  references,
  stages: ETAPAS,
  operationId: 'op-1',
  actorId: 'u-1',
  deps: { config: CONFIG, fetchImpl: impl, now: () => AGORA, sleep: async () => {} },
  now: () => AGORA,
});

describe('changeOrderStatus — Em aberto → Em andamento', () => {
  it('PATCH, lança contas quando a transição não lança, carimba, e a etapa acompanha', async () => {
    const estado: Estado = { situacao: 6, contas: [] };
    const bling = blingFalso(estado);
    const r = await changeOrderStatus(banco().client, pedido(), 'em_andamento', ctx(bling.impl));

    expect(bling.chamadas).toContain('PATCH /pedidos/vendas/5001/situacoes/15');
    expect(bling.chamadas.filter((c) => c.endsWith('/lancar-contas'))).toHaveLength(1);
    expect(r.status).toBe('succeeded');
    if (r.status === 'succeeded') {
      expect(r.dealPatch).toMatchObject({
        order_status: 'em_andamento',
        stage_id: 's-andamento',
        status: 'won',
        accounts_launched_at: new Date(AGORA).toISOString(),
        sync_version: 3,
      });
      expect(r.events?.map((e) => e.kind)).toEqual(['status_changed', 'accounts_launched']);
    }
  });

  it('o job repetido três vezes lança contas UMA vez', async () => {
    const estado: Estado = { situacao: 6, contas: [] };
    const bling = blingFalso(estado);
    // O carimbo nunca chega ao pedido carregado — o pior caso: a oportunidade
    // não foi atualizada entre as repetições.
    for (let i = 0; i < 3; i++) {
      const r = await changeOrderStatus(banco().client, pedido(), 'em_andamento', ctx(bling.impl));
      expect(r.status).toBe('succeeded');
    }
    expect(bling.chamadas.filter((c) => c.endsWith('/lancar-contas'))).toHaveLength(1);
    expect(bling.chamadas.filter((c) => c.startsWith('PATCH'))).toHaveLength(1);
  });

  it('transição do Bling que já lança: nenhuma chamada explícita', async () => {
    const estado: Estado = { situacao: 6, contas: [], transicaoLancaContas: true };
    const bling = blingFalso(estado);
    const referencias = [
      { kind: 'order_transition', bling_id: 't1', parent_bling_id: null, label: '', active: true, removed_at: null, payload: { from_id: '6', to_id: '15', action_ids: ['a1'] } },
      { kind: 'order_action', bling_id: 'a1', parent_bling_id: null, label: 'Lançar contas', active: true, removed_at: null, payload: {} },
    ] as Reference[];
    const r = await changeOrderStatus(banco().client, pedido(), 'em_andamento', ctx(bling.impl, referencias));
    expect(bling.chamadas.some((c) => c.endsWith('/lancar-contas'))).toBe(false);
    expect(r.status === 'succeeded' && r.events?.[1]?.detail).toMatchObject({ by: 'transition', verified: true });
  });

  it('recusa do Bling volta como está, e nada muda no CRM', async () => {
    const estado: Estado = { situacao: 6, contas: [], recusaPatch: 'Não é possível alterar o pedido, pois já foram realizadas as seguintes ações' };
    const bling = blingFalso(estado);
    const r = await changeOrderStatus(banco().client, pedido(), 'em_andamento', ctx(bling.impl));
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.error).toContain('Não é possível alterar o pedido');
      expect(r.dealPatch).toBeUndefined();
      expect(r.events?.map((e) => e.kind)).toEqual(['refused']);
    }
  });

  it('o Bling está em outra situação: divergente, sem PATCH', async () => {
    const bling = blingFalso({ situacao: 9, contas: [] });
    const r = await changeOrderStatus(banco().client, pedido(), 'em_andamento', ctx(bling.impl));
    expect(r).toMatchObject({ status: 'failed', error: 'remote_status_mismatch', dealPatch: { sync_status: 'divergent' } });
    expect(bling.chamadas.some((c) => c.startsWith('PATCH'))).toBe(false);
  });

  it('lançar contas cai depois do PATCH: repete; a repetição pula o PATCH e lança', async () => {
    const estado: Estado = { situacao: 6, contas: [], lancarContasFalhaUmaVez: true };
    const bling = blingFalso(estado);
    const primeira = await changeOrderStatus(banco().client, pedido(), 'em_andamento', ctx(bling.impl));
    // Repetindo, a situação NÃO vai para o CRM (a repetição precisa ver a de
    // antes); se esta for a última tentativa, vai.
    expect(primeira).toMatchObject({ status: 'retry', dealPatch: {}, finalDealPatch: { order_status: 'em_andamento', stage_id: 's-andamento' } });
    const segunda = await changeOrderStatus(banco().client, pedido(), 'em_andamento', ctx(bling.impl));
    expect(segunda.status).toBe('succeeded');
    expect(bling.chamadas.filter((c) => c.startsWith('PATCH'))).toHaveLength(1);
  });
});

describe('changeOrderStatus — cancelar e atender', () => {
  it('Em andamento → Cancelado estorna as contas e leva a Venda Perdida (D3)', async () => {
    const estado: Estado = { situacao: 15, contas: [{ id: 1, situacao: 1, origem: { id: 5001, tipoOrigem: 'venda' } }] };
    const bling = blingFalso(estado);
    const r = await changeOrderStatus(
      banco().client,
      pedido({ order_status: 'em_andamento', accounts_launched_at: '2026-09-14T10:00:00Z' }),
      'cancelado',
      ctx(bling.impl)
    );
    expect(bling.chamadas).toContain('POST /pedidos/vendas/5001/estornar-contas');
    expect(r.status === 'succeeded' && r.dealPatch).toMatchObject({
      order_status: 'cancelado',
      accounts_launched_at: null,
      stage_id: 's-perdida',
      status: 'lost',
      lost_reason: 'orderCanceled',
    });
  });

  it('Em andamento → Atendido lança estoque uma vez', async () => {
    const bling = blingFalso({ situacao: 15, contas: [{ id: 1, situacao: 1, origem: { id: 5001, tipoOrigem: 'venda' } }] });
    const r = await changeOrderStatus(
      banco().client,
      pedido({ order_status: 'em_andamento', accounts_launched_at: '2026-09-14T10:00:00Z' }),
      'atendido',
      ctx(bling.impl)
    );
    expect(bling.chamadas.filter((c) => c.endsWith('/lancar-estoque'))).toHaveLength(1);
    expect(r.status === 'succeeded' && r.dealPatch).toMatchObject({ order_status: 'atendido', stage_id: 's-atendido' });
  });

  it('passagem que a máquina não tem é recusada antes do Bling', async () => {
    const bling = blingFalso({ situacao: 6, contas: [] });
    const r = await changeOrderStatus(banco().client, pedido(), 'atendido', ctx(bling.impl));
    expect(r).toMatchObject({ status: 'failed', error: 'transition_not_allowed' });
    expect(bling.chamadas.filter((c) => c !== 'GET /pedidos/vendas/5001')).toEqual([]);
  });
});

describe('auditoria da 0.11.0 — mudança de situação', () => {
  it('Em andamento com o pedido do CRM diferente do que o Bling recebeu: nada muda lá', async () => {
    const bling = blingFalso({ situacao: 6, contas: [] });
    const r = await changeOrderStatus(banco().client, pedido({ bling_source_hash: 'outro' }), 'em_andamento', ctx(bling.impl));
    expect(r).toEqual({ status: 'failed', error: 'order_not_synced' });
    expect(bling.chamadas.some((c) => c.startsWith('PATCH') || c.endsWith('/lancar-contas'))).toBe(false);
  });

  it('repetição que já passou do PATCH completa o lançamento mesmo sem o resumo', async () => {
    const estado: Estado = { situacao: 15, contas: [] };
    const bling = blingFalso(estado);
    const r = await changeOrderStatus(banco().client, pedido({ bling_source_hash: null }), 'em_andamento', ctx(bling.impl));
    expect(r.status).toBe('succeeded');
    expect(bling.chamadas.filter((c) => c.endsWith('/lancar-contas'))).toHaveLength(1);
  });

  it('cancelar dez dias depois acha as contas pela data do pedido no Bling e estorna', async () => {
    const estado: Estado = {
      situacao: 15,
      dataPedido: '2026-09-02',
      consultas: [],
      contas: [{ id: 1, situacao: 1, dataEmissao: '2026-09-05', origem: { id: 5001, tipoOrigem: 'venda' } }],
    };
    const bling = blingFalso(estado);
    const r = await changeOrderStatus(
      banco().client,
      pedido({ order_status: 'em_andamento', sale_date: null, accounts_launched_at: '2026-09-05T10:00:00Z' }),
      'cancelado',
      ctx(bling.impl)
    );
    expect(estado.consultas?.[0]?.dataInicial).toBe('2026-08-26');
    expect(bling.chamadas).toContain('POST /pedidos/vendas/5001/estornar-contas');
    expect(r.status === 'succeeded' && r.dealPatch).toMatchObject({ accounts_launched_at: null, sync_status: 'synced' });
  });

  it('estorno que não se confirma: o carimbo fica e o pedido vai divergente', async () => {
    const estado: Estado = {
      situacao: 15,
      estornoNaoCancela: true,
      contas: [{ id: 1, situacao: 1, origem: { id: 5001, tipoOrigem: 'venda' } }],
    };
    const bling = blingFalso(estado);
    const r = await changeOrderStatus(
      banco().client,
      pedido({ order_status: 'em_andamento', accounts_launched_at: '2026-09-14T10:00:00Z' }),
      'cancelado',
      ctx(bling.impl)
    );
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    expect(r.dealPatch).not.toHaveProperty('accounts_launched_at');
    expect(r.dealPatch).toMatchObject({ order_status: 'cancelado', sync_status: 'divergent', sync_error: 'accounts_not_reversed' });
    expect(r.events?.map((e) => e.kind)).toContain('divergence');
  });

  it('contas lançadas e a conferência cai: a repetição já leva o carimbo', async () => {
    const estado: Estado = { situacao: 6, contas: [], consultaFalhaDepoisDeLancar: true };
    const bling = blingFalso(estado);
    const r = await changeOrderStatus(banco().client, pedido(), 'em_andamento', ctx(bling.impl));
    expect(r).toMatchObject({ status: 'retry', dealPatch: { accounts_launched_at: new Date(AGORA).toISOString() } });
  });

  it('o Bling recusa o estoque depois do PATCH: a situação vai para o CRM, com o erro, e não como recusa', async () => {
    const bling = blingFalso({ situacao: 15, estoqueRecusa: true, contas: [{ id: 1, situacao: 1, origem: { id: 5001, tipoOrigem: 'venda' } }] });
    const r = await changeOrderStatus(
      banco().client,
      pedido({ order_status: 'em_andamento', accounts_launched_at: '2026-09-14T10:00:00Z' }),
      'atendido',
      ctx(bling.impl)
    );
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error).toContain('Estoque insuficiente');
    expect(r.dealPatch).toMatchObject({ order_status: 'atendido', stage_id: 's-atendido' });
    expect(r.dealPatch).not.toHaveProperty('stock_launched_at');
    expect(r.events?.map((e) => e.kind)).toEqual(['status_changed', 'divergence']);
    expect(r.events?.[1]?.detail).toMatchObject({ reason: 'action_failed', action: 'launch_stock' });
  });

  it('lease perdido antes do PATCH: para sem escrever', async () => {
    const bling = blingFalso({ situacao: 6, contas: [] });
    const contexto = ctx(bling.impl);
    const r = await changeOrderStatus(banco().client, pedido(), 'em_andamento', {
      ...contexto,
      deps: {
        ...contexto.deps,
        beforeWrite: async () => {
          throw new BlingLeaseLostError('op-1');
        },
      },
    });
    expect(r).toMatchObject({ status: 'retry', error: 'lease_lost' });
    expect(bling.chamadas.some((c) => c.startsWith('PATCH'))).toBe(false);
  });
});

describe('receivablesSince', () => {
  it('a data do Bling decide, com sete dias de folga; sem ela, a mais antiga do CRM', () => {
    expect(receivablesSince({ remoteOrderDate: '2026-09-02', saleDate: '2026-09-10', createdAt: null, now: '2026-09-15T23:30:00.000Z' })).toBe('2026-08-26');
    expect(receivablesSince({ remoteOrderDate: null, saleDate: '2026-09-10', createdAt: '2026-08-20T10:00:00Z', now: '2026-09-15T12:00:00.000Z' })).toBe('2026-08-13');
    expect(receivablesSince({ remoteOrderDate: undefined, saleDate: null, createdAt: null, now: '2026-09-15T12:00:00.000Z' })).toBe('2026-09-08');
  });
});
