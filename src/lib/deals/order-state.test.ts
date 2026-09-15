import { describe, expect, it } from 'vitest';

import { currentOrder, remoteOrderState, watchOperation } from './order-state';

describe('currentOrder — a prop com a fila por cima', () => {
  it('sem leitura da fila, vale a prop', () => {
    const p = currentOrder({ order_status: 'em_aberto', bling_order_id: '5001', accounts_launched_at: null }, null);
    expect(p).toMatchObject({ lock: 'open', open: true, syncable: true, isOrder: true, blingOrderId: '5001' });
  });

  it('a situação mudou com a gaveta aberta: a trava e o "em aberto" vêm da fila', () => {
    const remoto = remoteOrderState({
      order_status: 'em_andamento',
      bling_order_id: '5001',
      accounts_launched_at: '2026-09-15T12:00:00Z',
      stage_id: 's-andamento',
      status: 'won',
    });
    const p = currentOrder({ order_status: 'em_aberto', bling_order_id: '5001', accounts_launched_at: null }, remoto);
    expect(p).toMatchObject({ lock: 'in_progress', open: false, syncable: false, accountsLaunchedAt: '2026-09-15T12:00:00Z' });
  });

  it('Compra futura: destravado, mas não sincronizável', () => {
    const p = currentOrder({ order_status: 'compra_futura', bling_order_id: '5001' }, null);
    expect(p).toMatchObject({ lock: 'open', open: false, syncable: false });
  });

  it('é pedido também com a chave gravada (criação incerta); o estado de sincronização sozinho, não', () => {
    expect(currentOrder({ bling_external_key: 'CRM-ORC-1' }, null).isOrder).toBe(true);
    // Uma sincronização que falhou antes de enviar não deixou pedido no Bling (091).
    expect(currentOrder({ sync_status: 'error' }, null).isOrder).toBe(false);
    expect(currentOrder({ sync_status: 'not_sent' }, null).isOrder).toBe(false);
    expect(currentOrder(null, null)).toMatchObject({ isOrder: false, syncable: true, lock: 'open' });
  });
});

describe('remoteOrderState', () => {
  it('texto vazio e ausência viram null', () => {
    expect(remoteOrderState({ order_status: '', sync_status: 'synced' })).toMatchObject({ orderStatus: null, syncStatus: 'synced', stageId: null });
    expect(remoteOrderState(null)).toBeNull();
  });
});

describe('watchOperation — acompanhar a operação pedida', () => {
  const deal = { sync_status: 'synced', bling_order_number: '14501' };

  it('outra operação terminando não é o desfecho desta', () => {
    expect(watchOperation('op-2', { deal, operation: { id: 'op-1', kind: 'update_order', status: 'succeeded' } })).toEqual({ kind: 'wait' });
    expect(watchOperation('op-2', { deal, operation: null })).toEqual({ kind: 'wait' });
    expect(watchOperation('op-2', null)).toEqual({ kind: 'wait' });
  });

  it('na fila ou rodando: espera', () => {
    for (const status of ['queued', 'running', 'uncertain']) {
      expect(watchOperation('op-1', { deal, operation: { id: 'op-1', kind: 'update_order', status } })).toEqual({ kind: 'wait' });
    }
  });

  it('sincronizou; ou passou e voltou diferente', () => {
    expect(watchOperation('op-1', { deal, operation: { id: 'op-1', kind: 'create_order', status: 'succeeded' } })).toEqual({
      kind: 'done',
      ok: true,
      outcome: 'synced',
    });
    expect(
      watchOperation('op-1', {
        deal: { sync_status: 'divergent', sync_error: 'diff:total' },
        operation: { id: 'op-1', kind: 'update_order', status: 'succeeded' },
      })
    ).toEqual({ kind: 'done', ok: false, outcome: 'divergent', error: 'diff:total' });
  });

  it('falhou, com o erro; mudança de situação concluída', () => {
    expect(watchOperation('op-1', { deal, operation: { id: 'op-1', kind: 'update_order', status: 'failed', error: 'order_not_open' } })).toEqual({
      kind: 'done',
      ok: false,
      outcome: 'failed',
      error: 'order_not_open',
    });
    expect(
      watchOperation('op-1', { deal: { sync_status: 'divergent' }, operation: { id: 'op-1', kind: 'change_status', status: 'succeeded' } })
    ).toEqual({ kind: 'done', ok: true, outcome: 'changed' });
  });
});
