import { describe, expect, it } from 'vitest';

import { fakeDb } from './fake-db';
import { enqueueOrderSync, retryDelaySeconds, runOperations } from './operations';

type Linha = Record<string, unknown>;

const DEAL = '671f940a-0000-4000-8000-00000000abcd';

/** A fila de mentira: o claim da 086 em memória, com o lease e o token. */
function banco(ops: Linha[], deal: Linha = {}) {
  let token = 0;
  const chamadasEnqueue: Linha[] = [];
  const db = fakeDb({
    tables: {
      bling_operations: ops,
      deals: [{ id: DEAL, account_id: 'acc-1', sync_status: 'syncing', sync_error: null, bling_order_id: null, ...deal }],
      deal_items: [],
      deal_installments: [],
      bling_settings: [],
      bling_connections: [],
      accounts: [{ id: 'acc-1', timezone: 'America/Sao_Paulo' }],
    },
    rpcs: {
      bling_claim_operations: (args, tables) => {
        const vencidas = tables.bling_operations.filter(
          (o) => (args.p_operation_id ? o.id === args.p_operation_id : true) && ['queued', 'uncertain'].includes(String(o.status))
        );
        return vencidas.map((o) => {
          o.status = 'running';
          o.attempts = Number(o.attempts) + 1;
          o.lock_token = `L${++token}`;
          return { id: o.id, lock_token: o.lock_token, attempts: o.attempts };
        });
      },
      bling_enqueue_operation: (args) => {
        chamadasEnqueue.push(args);
        return [{ operation_id: 'op-new', operation_status: 'queued', created: true }];
      },
    },
  });
  return { ...db, chamadasEnqueue };
}

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

  it('com pedido: atualizar, com o resumo do pedido gravado na chave', async () => {
    const db = banco([], { bling_order_id: '5001' });
    await enqueueOrderSync(db.client, { accountId: 'acc-1', dealId: DEAL, userId: null });
    const chave = String(db.chamadasEnqueue[0].p_key);
    expect(chave).toMatch(new RegExp(`^update_order:${DEAL}:[0-9a-f]{32}$`));

    // Mesmo pedido, mesma chave; pedido diferente, outra.
    await enqueueOrderSync(db.client, { accountId: 'acc-1', dealId: DEAL, userId: null });
    expect(db.chamadasEnqueue[1].p_key).toBe(chave);
    db.tables.deals[0].notes = 'mudou';
    await enqueueOrderSync(db.client, { accountId: 'acc-1', dealId: DEAL, userId: null });
    expect(db.chamadasEnqueue[2].p_key).not.toBe(chave);
  });

  it('oportunidade de outra conta: não enfileira', async () => {
    const db = banco([]);
    expect(await enqueueOrderSync(db.client, { accountId: 'outra', dealId: DEAL, userId: null })).toEqual({ error: 'not_found' });
    expect(db.chamadasEnqueue).toHaveLength(0);
  });
});

describe('runOperations — terminar com compare-and-set', () => {
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
    const agora = Date.parse('2026-09-15T12:00:00.000Z');
    await runOperations(db.client, {}, { today: async () => '2026-09-15', now: () => agora });
    expect(db.tables.bling_operations[0]).toMatchObject({ status: 'uncertain', error: 'unexpected', lock_token: null });
    expect(db.tables.bling_operations[0].next_attempt_at).toBe(new Date(agora + 30_000).toISOString());
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
});
