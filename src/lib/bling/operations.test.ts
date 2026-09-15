import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import { fakeDb } from './fake-db';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';
import {
  dropUnknownFinishColumns,
  enqueueOrderSync,
  enqueueStatusChange,
  FINISH_PATCH_COLUMNS,
  finishPlan,
  orderSyncKey,
  retryDelaySeconds,
  runOperations,
} from './operations';
import { loadOrderForBling, orderSourceHash } from './orders';

type Linha = Record<string, unknown>;

const DEAL = '671f940a-0000-4000-8000-00000000abcd';
const AGORA = Date.parse('2026-09-15T12:00:00.000Z');
const CONFIG = { clientId: 'id', clientSecret: 's', redirectUri: 'https://crm.example.com/cb' };

/**
 * A fila de mentira: o claim, o touch e o término da 090 em memória — lease
 * com dono (`lock_token`), um término que só vale para o dono, o patch da
 * oportunidade restrito às colunas de servidor e `sync_version` incrementado.
 */
function rpcsDaFila(estado: { token: number; chamadas: Array<{ nome: string; args: Linha }> }) {
  return {
    bling_claim_operations: (args: Linha, tables: Record<string, Linha[]>) => {
      estado.chamadas.push({ nome: 'claim', args });
      // Uma repetição agendada (`retry_seconds`) ainda não venceu.
      const vencidas = tables.bling_operations
        .filter(
          (o) =>
            (args.p_operation_id ? o.id === args.p_operation_id : true) &&
            ['queued', 'uncertain'].includes(String(o.status)) &&
            (o.retry_seconds === undefined || o.retry_seconds === null)
        )
        .slice(0, Number(args.p_limit ?? 5));
      return vencidas.map((o) => {
        o.status = 'running';
        o.attempts = Number(o.attempts) + 1;
        o.lock_token = `L${++estado.token}`;
        return { id: o.id, lock_token: o.lock_token, attempts: o.attempts };
      });
    },
    bling_touch_operation: (args: Linha, tables: Record<string, Linha[]>) => {
      estado.chamadas.push({ nome: 'touch', args });
      const op = tables.bling_operations.find((o) => o.id === args.p_operation_id);
      return !!op && op.status === 'running' && op.lock_token === args.p_lock_token;
    },
    bling_finish_operation: (args: Linha, tables: Record<string, Linha[]>) => {
      estado.chamadas.push({ nome: 'finish', args });
      const patch = (args.p_deal_patch ?? {}) as Linha;
      for (const coluna of Object.keys(patch)) {
        if (!(FINISH_PATCH_COLUMNS as readonly string[]).includes(coluna)) {
          throw new Error(`coluna ${coluna} não pode ser escrita pela fila`);
        }
      }
      const op = tables.bling_operations.find((o) => o.id === args.p_operation_id);
      if (!op || op.status !== 'running' || op.lock_token !== args.p_lock_token) return false;
      const status = String(args.p_status);
      Object.assign(op, {
        status,
        error: status === 'succeeded' ? null : args.p_error,
        result: status === 'succeeded' ? args.p_result : status === 'failed' ? null : op.result,
        retry_seconds: args.p_retry_seconds,
        lock_token: null,
        locked_until: null,
        finished_at: status === 'succeeded' || status === 'failed' ? 'agora' : null,
      });
      const deal = (tables.deals ?? []).find((d) => d.id === op.deal_id && d.account_id === op.account_id);
      if (deal && Object.keys(patch).length > 0) {
        const { sync_version: versao, ...resto } = patch;
        Object.assign(deal, resto);
        if (versao !== undefined) deal.sync_version = Number(deal.sync_version ?? 0) + 1;
      }
      for (const e of (args.p_events ?? []) as Linha[]) {
        (tables.deal_order_events ??= []).push({ ...e, account_id: op.account_id, deal_id: op.deal_id, operation_id: op.id, source: 'crm' });
      }
      return true;
    },
  };
}

/** A fila com uma oportunidade mínima (sem Bling configurado). */
function banco(ops: Linha[], deal: Linha = {}) {
  const estado = { token: 0, chamadas: [] as Array<{ nome: string; args: Linha }> };
  const chamadasEnqueue: Linha[] = [];
  const db = fakeDb({
    tables: {
      bling_operations: ops,
      deals: [{ id: DEAL, account_id: 'acc-1', sync_status: 'syncing', sync_error: null, bling_order_id: null, sync_version: 0, ...deal }],
      deal_items: [],
      deal_installments: [],
      deal_order_events: [],
      bling_settings: [],
      bling_connections: [],
      accounts: [{ id: 'acc-1', timezone: 'America/Sao_Paulo' }],
    },
    rpcs: {
      ...rpcsDaFila(estado),
      bling_enqueue_operation: (args) => {
        chamadasEnqueue.push(args);
        return [{ operation_id: 'op-new', operation_status: 'queued', created: true }];
      },
    },
  });
  return { ...db, chamadasEnqueue, fila: estado };
}

/** A oportunidade completa e sincronizável, com o Bling configurado. */
function bancoCompleto(ops: Linha[] = [], deal: Linha = {}) {
  const estado = { token: 0, chamadas: [] as Array<{ nome: string; args: Linha }> };
  const db = fakeDb({
    tables: {
      bling_operations: ops,
      bling_connections: [
        {
          id: 'conn-1',
          account_id: 'acc-1',
          company_id: 'emp-1',
          company_name: 'Empresa',
          status: 'connected',
          access_token: encrypt('access'),
          access_expires_at: new Date(AGORA + 3_600_000).toISOString(),
          refresh_token: encrypt('refresh'),
          refresh_lock_until: null,
          consecutive_failures: 0,
        },
      ],
      bling_settings: [{ account_id: 'acc-1', company_id: 'emp-1', orders_enabled: true, status_open_id: '6', status_in_progress_id: '15' }],
      deals: [
        {
          id: DEAL,
          account_id: 'acc-1',
          contact_id: 'c-1',
          assigned_to: null,
          carrier_id: 'car-1',
          sale_date: '2026-09-15',
          shipping_cost: 0,
          freight_mode: '9',
          order_status: 'em_aberto',
          bling_order_id: '5001',
          bling_external_key: null,
          sync_status: 'syncing',
          sync_version: 3,
          ...deal,
        },
      ],
      deal_items: [
        {
          account_id: 'acc-1',
          deal_id: DEAL,
          product_id: 'p-1',
          name: 'Lona 4x5',
          quantity: 2,
          unit_price: 50,
          discount_percent: 0,
          position: 0,
          bling_product_id: '1600',
          revenue_category_bling_id: '901',
          defines_order_category: true,
        },
      ],
      deal_installments: [{ account_id: 'acc-1', deal_id: DEAL, position: 0, due_on: '2026-10-15', amount: 100, payment_method_bling_id: '7001' }],
      contacts: [{ id: 'c-1', account_id: 'acc-1', name: 'Cliente Exemplo', company: 'Empresa Exemplo', tax_id: '11222333000181', person_type: 'J', bling_contact_id: '5551' }],
      carriers: [{ id: 'car-1', account_id: 'acc-1', name: 'Cliente retira', bling_contact_id: null, bling_contact_name: null, default_freight_payer_code: '9', is_customer_pickup: true }],
      products: [{ id: 'p-1', account_id: 'acc-1', active: true, bling_product_id: '1600', bling_product_type: null, bling_family_id: null, revenue_category_bling_id: '901', defines_order_category: true }],
      profiles: [],
      bling_references: [],
      deal_order_events: [],
      accounts: [{ id: 'acc-1', timezone: 'America/Sao_Paulo' }],
    },
    rpcs: { ...rpcsDaFila(estado), bling_take_request: () => 0 },
  });
  return { ...db, fila: estado };
}

function blingFalso() {
  const chamadas: string[] = [];
  const impl: FetchLike = async (url, init) => {
    if (url === BLING_TOKEN_URL) throw new Error('não deveria renovar');
    const u = new URL(url);
    const caminho = u.pathname.replace('/Api/v3', '');
    const metodo = init?.method ?? 'GET';
    chamadas.push(`${metodo} ${caminho}`);
    if (caminho.startsWith('/contatos')) {
      // Um contato vazio lá: o CRM completa (e isso é um PUT).
      return new Response(JSON.stringify({ data: { id: 5551, nome: '', numeroDocumento: '11222333000181' } }), { status: 200 });
    }
    if (metodo === 'GET') {
      return new Response(JSON.stringify({ data: { id: 5001, numero: 14501, total: 100, itens: [{}], contato: { id: 5551 }, situacao: { id: 6 } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { id: 5001 } }), { status: 200 });
  };
  return { impl, chamadas };
}

const depsDoBling = (impl: FetchLike) => ({
  today: async () => '2026-09-15',
  now: () => AGORA,
  client: { config: CONFIG, fetchImpl: impl, now: () => AGORA, sleep: async () => {} },
});

describe('retryDelaySeconds', () => {
  it('sobe em escada e para em uma hora', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelaySeconds)).toEqual([30, 120, 600, 1800, 3600, 3600]);
  });
});

describe('enqueueOrderSync', () => {
  it('sem pedido no Bling: criar, com uma chave por oportunidade', async () => {
    const db = banco([]);
    const r = await enqueueOrderSync(db.client, { accountId: 'acc-1', dealId: DEAL, userId: 'u-1' });
    expect(r).toMatchObject({ operationId: 'op-new', kind: 'create_order', created: true });
    expect(db.chamadasEnqueue[0]).toMatchObject({ p_kind: 'create_order', p_key: `create_order:${DEAL}`, p_requested_by: 'u-1' });
  });

  it('com pedido: atualizar, com a versão e o resumo do pedido gravado na chave', async () => {
    const db = banco([], { bling_order_id: '5001', sync_version: 4 });
    await enqueueOrderSync(db.client, { accountId: 'acc-1', dealId: DEAL, userId: null });
    const chave = String(db.chamadasEnqueue[0].p_key);
    expect(chave).toMatch(new RegExp(`^update_order:${DEAL}:4:[0-9a-f]{32}$`));

    // Mesmo pedido, mesma chave; pedido diferente, outra.
    await enqueueOrderSync(db.client, { accountId: 'acc-1', dealId: DEAL, userId: null });
    expect(db.chamadasEnqueue[1].p_key).toBe(chave);
    db.tables.deals[0].notes = 'mudou';
    await enqueueOrderSync(db.client, { accountId: 'acc-1', dealId: DEAL, userId: null });
    expect(db.chamadasEnqueue[2].p_key).not.toBe(chave);
  });

  it('o mesmo conteúdo depois de uma sincronização é outra operação (150 → 100 → 150)', async () => {
    const db = banco([], { bling_order_id: '5001', sync_version: 4, shipping_cost: 150 });
    const pedido = (await loadOrderForBling(db.client, 'acc-1', DEAL))!;
    const antes = orderSyncKey('update_order', pedido);
    db.tables.deals[0].sync_version = 6;
    const depois = orderSyncKey('update_order', (await loadOrderForBling(db.client, 'acc-1', DEAL))!);
    expect(depois).not.toBe(antes);
    expect(depois.endsWith(orderSourceHash(pedido).slice(0, 32))).toBe(true);
  });

  it('oportunidade de outra conta: não enfileira', async () => {
    const db = banco([]);
    expect(await enqueueOrderSync(db.client, { accountId: 'outra', dealId: DEAL, userId: null })).toEqual({ error: 'not_found' });
    expect(db.chamadasEnqueue).toHaveLength(0);
  });
});

describe('enqueueStatusChange', () => {
  it('Em andamento só com o pedido sincronizado e igual ao que o Bling recebeu', async () => {
    const db = bancoCompleto([], { sync_status: 'synced' });
    const chamadas: Linha[] = [];
    const rpcOriginal = db.client.rpc.bind(db.client);
    (db.client as unknown as { rpc: typeof db.client.rpc }).rpc = (async (nome: string, args: Linha) => {
      if (nome === 'bling_enqueue_operation') {
        chamadas.push(args);
        return { data: [{ operation_id: 'op-s', operation_status: 'queued', created: true }], error: null };
      }
      return rpcOriginal(nome, args);
    }) as unknown as typeof db.client.rpc;

    const args = { accountId: 'acc-1', dealId: DEAL, userId: 'u-1', to: 'em_andamento' };
    expect(await enqueueStatusChange(db.client, args)).toEqual({ error: 'order_not_synced' });

    db.tables.deals[0].bling_source_hash = orderSourceHash((await loadOrderForBling(db.client, 'acc-1', DEAL))!);
    expect(await enqueueStatusChange(db.client, args)).toMatchObject({ operationId: 'op-s', kind: 'change_status' });

    // Uma parcela trocada depois: não sincronizado de novo.
    db.tables.deal_installments[0].due_on = '2026-10-30';
    expect(await enqueueStatusChange(db.client, args)).toEqual({ error: 'order_not_synced' });

    // Com erro na última sincronização, também não.
    db.tables.deal_installments[0].due_on = '2026-10-15';
    db.tables.deals[0].sync_status = 'error';
    expect(await enqueueStatusChange(db.client, args)).toEqual({ error: 'order_not_synced' });
    expect(chamadas).toHaveLength(1);

    // Cancelar não depende disso.
    expect(await enqueueStatusChange(db.client, { ...args, to: 'cancelado' })).toMatchObject({ operationId: 'op-s' });
  });
});

describe('finishPlan', () => {
  it('última tentativa de uma repetição leva o que vale no fim (a situação que já mudou lá)', () => {
    const plano = finishPlan(
      { attempts: 6, max_attempts: 6 },
      { status: 'retry', error: 'bling:503:fora', uncertain: false, dealPatch: { accounts_launched_at: 'x' }, finalDealPatch: { order_status: 'em_andamento' } }
    );
    expect(plano).toMatchObject({
      status: 'failed',
      dealPatch: { sync_status: 'error', sync_error: 'bling:503:fora', accounts_launched_at: 'x', order_status: 'em_andamento' },
    });
    const repetindo = finishPlan(
      { attempts: 2, max_attempts: 6 },
      { status: 'retry', error: 'bling:503:fora', uncertain: true, finalDealPatch: { order_status: 'em_andamento' } }
    );
    expect(repetindo).toMatchObject({ status: 'uncertain', retrySeconds: 120 });
    expect(repetindo.dealPatch).not.toHaveProperty('order_status');
  });
});

describe('runOperations — pegar uma por vez, terminar numa transação', () => {
  const op = (extra: Linha = {}): Linha => ({
    id: 'op-1',
    account_id: 'acc-1',
    deal_id: DEAL,
    kind: 'create_order',
    status: 'queued',
    attempts: 0,
    max_attempts: 6,
    ...extra,
  });

  it('falha de vez: operação failed e a oportunidade em erro, com a mensagem', async () => {
    // Sem configuração do Bling: `orders_disabled`, que não se resolve repetindo.
    const db = banco([op()]);
    expect(await runOperations(db.client, { operationId: 'op-1' }, { today: async () => '2026-09-15' })).toBe(1);
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'failed', error: 'orders_disabled', lock_token: null });
    expect(db.tables.deals[0]).toMatchObject({ sync_status: 'error', sync_error: 'orders_disabled' });
  });

  it('lançar isolado não é operação da tela: falha, não repete', async () => {
    const db = banco([op({ kind: 'launch_accounts' })]);
    await runOperations(db.client, {}, { today: async () => '2026-09-15' });
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'failed', error: 'unsupported:launch_accounts' });
  });

  it('pega UMA por vez, até o limite', async () => {
    const db = banco([op(), op({ id: 'op-2' }), op({ id: 'op-3' })]);
    expect(await runOperations(db.client, { limit: 2 }, { today: async () => '2026-09-15' })).toBe(2);
    const claims = db.fila.chamadas.filter((c) => c.nome === 'claim');
    expect(claims).toHaveLength(2);
    expect(claims.every((c) => c.args.p_limit === 1)).toBe(true);
    expect(db.tables.bling_operations.map((o) => o.status)).toEqual(['failed', 'failed', 'queued']);
  });

  it('estouro no meio de criar: incerto, com a próxima tentativa agendada', async () => {
    const db = banco([op()]);
    const fromOriginal = db.client.from.bind(db.client);
    let caiu = false;
    (db.client as unknown as { from: typeof db.client.from }).from = ((nome: string) => {
      // Cai uma vez, na leitura do pedido; o registro do desfecho passa.
      if (nome === 'deals' && !caiu) {
        caiu = true;
        throw new Error('conexão caiu');
      }
      return fromOriginal(nome);
    }) as unknown as typeof db.client.from;
    await runOperations(db.client, {}, { today: async () => '2026-09-15', now: () => AGORA });
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'uncertain', error: 'unexpected', lock_token: null, retry_seconds: 30 });
  });

  it('esgotou as tentativas: falha mesmo sendo passageiro', async () => {
    // O claim soma a sexta tentativa; o estouro seria passageiro, mas acabou.
    const db = banco([op({ attempts: 5, max_attempts: 6 })]);
    const fromOriginal = db.client.from.bind(db.client);
    let caiu = false;
    (db.client as unknown as { from: typeof db.client.from }).from = ((nome: string) => {
      if (nome === 'deals' && !caiu) {
        caiu = true;
        throw new Error('conexão caiu');
      }
      return fromOriginal(nome);
    }) as unknown as typeof db.client.from;
    await runOperations(db.client, {}, { today: async () => '2026-09-15' });
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'failed', error: 'unexpected', attempts: 6 });
    expect(db.tables.deals[0]).toMatchObject({ sync_status: 'error', sync_error: 'unexpected' });
  });

  it('lease perdido: quem perdeu não sobrescreve a operação nem a oportunidade', async () => {
    const db = banco([op()]);
    const rpcOriginal = db.client.rpc.bind(db.client);
    // Outro processo pega a mesma operação logo depois do claim.
    (db.client as unknown as { rpc: typeof db.client.rpc }).rpc = (async (nome: string, args: Linha) => {
      const r = await rpcOriginal(nome, args);
      if (nome === 'bling_claim_operations') db.tables.bling_operations[0].lock_token = 'OUTRO';
      return r;
    }) as unknown as typeof db.client.rpc;
    await runOperations(db.client, {}, { today: async () => '2026-09-15' });
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'running', lock_token: 'OUTRO' });
    expect(db.tables.deals[0]).toMatchObject({ sync_status: 'syncing', sync_error: null });
  });

  it('lease perdido ANTES de escrever no Bling: nenhuma escrita sai', async () => {
    const db = bancoCompleto([op({ kind: 'update_order' })]);
    const bling = blingFalso();
    const rpcOriginal = db.client.rpc.bind(db.client);
    (db.client as unknown as { rpc: typeof db.client.rpc }).rpc = (async (nome: string, args: Linha) => {
      const r = await rpcOriginal(nome, args);
      if (nome === 'bling_claim_operations') db.tables.bling_operations[0].lock_token = 'OUTRO';
      return r;
    }) as unknown as typeof db.client.rpc;
    await runOperations(db.client, {}, depsDoBling(bling.impl));
    expect(bling.chamadas.filter((c) => !c.startsWith('GET'))).toEqual([]);
    expect(db.fila.chamadas.some((c) => c.nome === 'touch')).toBe(true);
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'running', lock_token: 'OUTRO' });
  });

  it('com o lease vivo: renova antes de cada escrita, termina e grava o vínculo e o resumo juntos', async () => {
    const db = bancoCompleto([op({ kind: 'update_order' })]);
    const bling = blingFalso();
    await runOperations(db.client, {}, depsDoBling(bling.impl));
    const escritas = bling.chamadas.filter((c) => !c.startsWith('GET'));
    expect(escritas).toEqual(['PUT /contatos/5551', 'PUT /pedidos/vendas/5001']);
    expect(db.fila.chamadas.filter((c) => c.nome === 'touch')).toHaveLength(escritas.length);
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'succeeded' });
    expect(db.tables.deals[0]).toMatchObject({ sync_status: 'synced', sync_version: 4 });
    expect(db.tables.deals[0].bling_source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(db.tables.deal_order_events.map((e) => e.kind)).toEqual(['order_updated']);
  });

  it('coluna fora da lista do término: sai do patch em vez de travar a fila', () => {
    expect(dropUnknownFinishColumns({ sync_status: 'synced', title: 'x', stage_id: 's-1' })).toEqual({
      patch: { sync_status: 'synced', stage_id: 's-1' },
      dropped: ['title'],
    });
  });

  it('o banco recusa o histórico: termina sem ele', async () => {
    const db = bancoCompleto([op({ kind: 'update_order' })]);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpcOriginal = db.client.rpc.bind(db.client);
    const eventosPedidos: number[] = [];
    (db.client as unknown as { rpc: typeof db.client.rpc }).rpc = (async (nome: string, args: Linha) => {
      if (nome === 'bling_finish_operation') {
        eventosPedidos.push((args.p_events as Linha[]).length);
        if (eventosPedidos.length === 1) return { data: null, error: { code: '23514', message: 'deal_order_events_kind_check' } };
      }
      return rpcOriginal(nome, args);
    }) as unknown as typeof db.client.rpc;
    await runOperations(db.client, {}, depsDoBling(blingFalso().impl));
    expect(eventosPedidos).toEqual([1, 0]);
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'succeeded' });
    expect(db.tables.deals[0]).toMatchObject({ sync_status: 'synced' });
    expect(db.tables.deal_order_events).toHaveLength(0);
    erro.mockRestore();
  });
});

describe('a lista de colunas do término é a do SQL', () => {
  it('FINISH_PATCH_COLUMNS espelha `bling_finish_operation` da migração mais nova', () => {
    const pasta = join(process.cwd(), 'supabase', 'migrations');
    const arquivo = readdirSync(pasta)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort()
      .reverse()
      .find((f) => /FUNCTION\s+public\.bling_finish_operation\s*\(/.test(readFileSync(join(pasta, f), 'utf8')));
    expect(arquivo).toBeDefined();
    const sql = readFileSync(join(pasta, arquivo as string), 'utf8');
    const corpo = sql.slice(sql.search(/FUNCTION\s+public\.bling_finish_operation/));
    const lista = corpo.match(/c_colunas\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/);
    expect(lista).not.toBeNull();
    const doSql = [...(lista as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...FINISH_PATCH_COLUMNS].sort()).toEqual(doSql);
    // E cada uma é escrita no UPDATE da função.
    for (const coluna of doSql) expect(corpo).toMatch(new RegExp(`\\b${coluna} = CASE WHEN v_patch \\? '${coluna}'`));
  });
});
