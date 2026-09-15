import { describe, expect, it } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import { fakeDb } from './fake-db';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';
import { applyRemoteOrder, blingDateTime, reconcileOrders, webhookLooksSilent } from './reconcile';

const AGORA = Date.parse('2026-09-15T12:00:00.000Z');
const CONFIG = { clientId: 'id', clientSecret: 's', redirectUri: 'https://crm.example.com/cb' };
const SETTINGS = { status_open_id: '6', status_in_progress_id: '15', status_fulfilled_id: '9', status_canceled_id: '12', status_future_purchase_id: '400' };

function banco(deal: Record<string, unknown> = {}) {
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
          orders_cursor: null,
        },
      ],
      deals: [
        {
          id: 'd-1',
          account_id: 'acc-1',
          user_id: 'u-criador',
          assigned_to: null,
          contact_id: null,
          pipeline_id: 'p-1',
          order_status: 'em_andamento',
          bling_order_id: '5001',
          bling_order_number: '14501',
          bling_external_key: 'CRM-ORC-AAAA',
          sync_status: 'synced',
          sync_version: 1,
          shipping_cost: 0,
          ...deal,
        },
      ],
      deal_items: [{ account_id: 'acc-1', deal_id: 'd-1', name: 'Lona', quantity: 2, unit_price: 50, discount_percent: 0 }],
      pipeline_stages: [
        { id: 's-atendido', name: 'Atendido', pipeline_id: 'p-1' },
        { id: 's-perdida', name: 'Venda Perdida', pipeline_id: 'p-1' },
      ],
      bling_operations: [],
      deal_order_events: [],
      notifications: [],
      profiles: [],
    },
    rpcs: { bling_take_request: () => 0 },
  });
}

const remoto = (extra: Record<string, unknown> = {}) => ({
  id: '5001',
  numero: '14501',
  numeroLoja: 'CRM-ORC-AAAA',
  situacaoId: '15',
  total: 100,
  ...extra,
});

describe('applyRemoteOrder', () => {
  it('nada mudou: nada escrito', async () => {
    const db = banco();
    expect(await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto(), source: 'reconcile' })).toBe('unchanged');
    expect(db.tables.deal_order_events).toHaveLength(0);
  });

  it('cancelado à mão no Bling: Venda Perdida com "Pedido cancelado", e quem criou é avisado', async () => {
    const db = banco();
    const r = await applyRemoteOrder(db.client, {
      accountId: 'acc-1',
      settings: SETTINGS,
      remote: remoto({ situacaoId: '12' }),
      source: 'reconcile',
      now: () => AGORA,
    });
    expect(r).toBe('updated');
    expect(db.tables.deals[0]).toMatchObject({ order_status: 'cancelado', stage_id: 's-perdida', status: 'lost', lost_reason: 'orderCanceled' });
    expect(db.tables.deal_order_events[0]).toMatchObject({ source: 'reconcile', kind: 'status_changed' });
    expect(db.tables.notifications[0]).toMatchObject({ user_id: 'u-criador', body: 'manual_change' });
  });

  it('total diferente: divergente uma vez só', async () => {
    const db = banco();
    expect(await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto({ total: 99.99 }), source: 'bling' })).toBe('diverged');
    expect(db.tables.deals[0]).toMatchObject({ sync_status: 'divergent', sync_error: 'diff:total' });
    expect(await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto({ total: 99.99 }), source: 'bling' })).toBe('unchanged');
    expect(db.tables.notifications).toHaveLength(1);
  });

  it('apagado no Bling: divergente', async () => {
    const db = banco();
    await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto({ deleted: true }), source: 'bling' });
    expect(db.tables.deals[0]).toMatchObject({ sync_status: 'divergent', sync_error: 'remote_missing' });
  });

  it('criação incerta: a chave do CRM liga o pedido', async () => {
    const db = banco({ bling_order_id: null, bling_order_number: null });
    await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto({ id: '5002' }), source: 'reconcile' });
    expect(db.tables.deals[0]).toMatchObject({ bling_order_id: '5002', bling_order_number: '14501' });
  });

  it('pedido de fora do CRM ou de outra conta: ignorado', async () => {
    const db = banco();
    expect(await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto({ id: '1', numeroLoja: 'LOJA' }), source: 'bling' })).toBe('ignored');
    expect(await applyRemoteOrder(db.client, { accountId: 'outra', settings: SETTINGS, remote: remoto(), source: 'bling' })).toBe('ignored');
  });
});

describe('reconcileOrders', () => {
  it('só os pedidos do CRM, desde o cursor menos a sobreposição; o cursor anda', async () => {
    const db = banco();
    const pedidas: string[] = [];
    const impl: FetchLike = async (url) => {
      if (url === BLING_TOKEN_URL) throw new Error('não deveria renovar');
      pedidas.push(new URL(url).searchParams.get('dataAlteracaoInicial') ?? '');
      return new Response(
        JSON.stringify({
          data: [
            { id: 5001, numero: 14501, numeroLoja: 'CRM-ORC-AAAA', total: 100, situacao: { id: 9 } },
            { id: 7000, numero: 1, numeroLoja: 'LOJA-X', total: 5, situacao: { id: 9 } },
          ],
        }),
        { status: 200 }
      );
    };
    const r = await reconcileOrders(
      db.client,
      { id: 'conn-1', account_id: 'acc-1', orders_cursor: '2026-09-15T11:45:00.000Z' },
      SETTINGS,
      { deps: { config: CONFIG, fetchImpl: impl, now: () => AGORA, sleep: async () => {} }, now: () => AGORA }
    );
    expect(r).toEqual({ checked: 1, updated: 1, diverged: 0 });
    // 11:45 UTC − 10 min = 11:35 UTC = 08:35 em Brasília.
    expect(pedidas[0]).toBe('2026-09-15 08:35:00');
    expect(db.tables.bling_connections[0]).toMatchObject({
      orders_cursor: new Date(AGORA).toISOString(),
      reconcile_found_at: new Date(AGORA).toISOString(),
    });
    expect(db.tables.deals[0].order_status).toBe('atendido');
  });
});

describe('saúde', () => {
  it('data e hora no formato do filtro do Bling', () => {
    expect(blingDateTime(Date.parse('2026-01-02T03:04:05Z'))).toBe('2026-01-02 00:04:05');
  });

  it('webhook calado: a conferência achou mudança depois do último aviso', () => {
    expect(webhookLooksSilent({ ordersEnabled: true, lastWebhookAt: null, reconcileFoundAt: '2026-09-15T12:00:00Z' })).toBe(true);
    expect(webhookLooksSilent({ ordersEnabled: true, lastWebhookAt: '2026-09-15T10:00:00Z', reconcileFoundAt: '2026-09-15T12:00:00Z' })).toBe(true);
    expect(webhookLooksSilent({ ordersEnabled: true, lastWebhookAt: '2026-09-15T11:50:00Z', reconcileFoundAt: '2026-09-15T12:00:00Z' })).toBe(false);
    expect(webhookLooksSilent({ ordersEnabled: false, lastWebhookAt: null, reconcileFoundAt: '2026-09-15T12:00:00Z' })).toBe(false);
  });
});

describe('applyRemoteOrder — auditoria da 0.11.0', () => {
  it('a chave acha uma oportunidade ligada a OUTRO pedido: duplicado, e nada dele é aplicado', async () => {
    const db = banco();
    const duplicado = remoto({ id: '5002', numero: '14502', situacaoId: '12' });
    expect(await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: duplicado, source: 'bling' })).toBe('diverged');
    expect(db.tables.deals[0]).toMatchObject({
      bling_order_id: '5001',
      bling_order_number: '14501',
      order_status: 'em_andamento',
      sync_status: 'divergent',
      sync_error: 'duplicate_remote',
    });
    expect(db.tables.deals[0]).not.toHaveProperty('lost_reason');
    expect(db.tables.deal_order_events[0]).toMatchObject({ kind: 'divergence', detail: { reason: 'duplicate_remote', remoteId: '5002' } });
    expect(db.tables.notifications).toHaveLength(1);
    // Uma vez só; e apagar o duplicado é a solução, não outra divergência.
    expect(await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: duplicado, source: 'bling' })).toBe('ignored');
  });

  it('duplicado apagado no Bling: ignorado', async () => {
    const db = banco();
    expect(
      await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto({ id: '5002', deleted: true }), source: 'bling' })
    ).toBe('ignored');
    expect(db.tables.deals[0]).toMatchObject({ sync_status: 'synced' });
  });

  it('atualização do CRM esperando a próxima tentativa não engole o cancelamento feito à mão', async () => {
    const db = banco();
    db.tables.bling_operations.push({ id: 'op-1', account_id: 'acc-1', deal_id: 'd-1', kind: 'update_order', params: {}, status: 'queued' });
    const r = await applyRemoteOrder(db.client, {
      accountId: 'acc-1',
      settings: SETTINGS,
      remote: remoto({ situacaoId: '12', total: 99.99 }),
      source: 'reconcile',
      now: () => AGORA,
    });
    expect(r).toBe('updated');
    expect(db.tables.deals[0]).toMatchObject({ order_status: 'cancelado', status: 'lost' });
    // O total de lá ainda é o de antes da atualização: não é divergência.
    expect(db.tables.deals[0].sync_status).toBe('synced');
  });

  it('eco de verdade: a mudança pedida pelo CRM para esta situação', async () => {
    const db = banco();
    db.tables.bling_operations.push({ id: 'op-1', account_id: 'acc-1', deal_id: 'd-1', kind: 'change_status', params: { to: 'atendido' }, status: 'running' });
    expect(await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto({ situacaoId: '9' }), source: 'bling' })).toBe('echo');
    expect(db.tables.deals[0].order_status).toBe('em_andamento');
    expect(db.tables.notifications).toHaveLength(0);
  });

  it('linha de outra conta não entra na soma do total', async () => {
    const db = banco();
    db.tables.deal_items.push({ account_id: 'outra', deal_id: 'd-1', name: 'Forjada', quantity: 1, unit_price: 1000, discount_percent: 0 });
    expect(await applyRemoteOrder(db.client, { accountId: 'acc-1', settings: SETTINGS, remote: remoto(), source: 'reconcile' })).toBe('unchanged');
  });
});
