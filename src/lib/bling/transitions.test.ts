import { describe, expect, it } from 'vitest';

import type { Reference } from './health';
import {
  blingStatusId,
  canChangeStatus,
  classifyAction,
  dealPatchForStatus,
  dragAllowed,
  planStatusChange,
  stageForStatus,
  statusFromBlingId,
  transitionActions,
} from './transitions';

const SETTINGS = {
  status_open_id: '6',
  status_in_progress_id: '15',
  status_fulfilled_id: '9',
  status_canceled_id: '12',
  status_future_purchase_id: '400',
};

const REF = (r: Partial<Reference>): Reference =>
  ({ kind: 'order_action', bling_id: '1', parent_bling_id: null, label: '', active: true, removed_at: null, payload: {}, ...r }) as Reference;

describe('a máquina de estados', () => {
  it('as passagens do §6, e nada além delas', () => {
    expect(canChangeStatus('em_aberto', 'em_andamento')).toBe(true);
    expect(canChangeStatus('em_andamento', 'atendido')).toBe(true);
    expect(canChangeStatus('em_aberto', 'compra_futura')).toBe(true);
    expect(canChangeStatus('compra_futura', 'em_aberto')).toBe(true);
    expect(canChangeStatus('em_andamento', 'cancelado')).toBe(true);
    // Atendido é final; não se pula de Em aberto para Atendido.
    expect(canChangeStatus('atendido', 'cancelado')).toBe(false);
    expect(canChangeStatus('em_aberto', 'atendido')).toBe(false);
    expect(canChangeStatus('compra_futura', 'em_andamento')).toBe(false);
    expect(canChangeStatus('cancelado', 'em_aberto')).toBe(false);
  });

  it('ids do Bling pelos papéis confirmados, nos dois sentidos', () => {
    expect(blingStatusId(SETTINGS, 'em_andamento')).toBe('15');
    expect(statusFromBlingId(SETTINGS, 12)).toBe('cancelado');
    expect(statusFromBlingId(SETTINGS, 999)).toBeNull();
    expect(blingStatusId({}, 'em_aberto')).toBeNull();
  });
});

describe('o que a transição do Bling já faz', () => {
  it('lê as ações pelo nome', () => {
    expect(classifyAction('Lançar contas')).toBe('launch_accounts');
    expect(classifyAction('Estornar contas a receber')).toBe('reverse_accounts');
    expect(classifyAction('Lançar estoque')).toBe('launch_stock');
    expect(classifyAction('ESTORNAR ESTOQUE')).toBe('reverse_stock');
    expect(classifyAction('Enviar e-mail')).toBeNull();
  });

  it('acha a transição configurada e as ações dela', () => {
    const referencias = [
      REF({ kind: 'order_transition', bling_id: 't1', label: 'Em aberto → Em andamento', payload: { from_id: '6', to_id: '15', action_ids: ['a1', 'a2'] } }),
      REF({ bling_id: 'a1', label: 'Lançar contas' }),
      REF({ bling_id: 'a2', label: 'Notificar' }),
    ];
    const r = transitionActions(referencias, SETTINGS, 'em_aberto', 'em_andamento');
    expect(r.found).toBe(true);
    expect([...r.actions]).toEqual(['launch_accounts']);
    expect(transitionActions(referencias, SETTINGS, 'em_andamento', 'atendido').found).toBe(false);
  });
});

describe('planStatusChange — os carimbos fazem repetir sem relançar', () => {
  it('Em andamento lança contas uma vez', () => {
    expect(planStatusChange({ to: 'em_andamento', accountsLaunched: false, stockLaunched: false })).toEqual({ accounts: 'launch', stock: null });
    expect(planStatusChange({ to: 'em_andamento', accountsLaunched: true, stockLaunched: false })).toEqual({ accounts: null, stock: null });
  });

  it('Atendido lança estoque; Cancelado estorna só o que houver', () => {
    expect(planStatusChange({ to: 'atendido', accountsLaunched: true, stockLaunched: false })).toEqual({ accounts: null, stock: 'launch' });
    expect(planStatusChange({ to: 'cancelado', accountsLaunched: true, stockLaunched: false })).toEqual({ accounts: 'reverse', stock: null });
    expect(planStatusChange({ to: 'cancelado', accountsLaunched: false, stockLaunched: false })).toEqual({ accounts: null, stock: null });
    expect(planStatusChange({ to: 'compra_futura', accountsLaunched: false, stockLaunched: false })).toEqual({ accounts: null, stock: null });
  });
});

describe('a etapa acompanha (D1-B) e o cancelado perde (D3)', () => {
  const etapas = [
    { id: 'v-andamento', name: 'Em Andamento', pipeline_id: 'vendas' },
    { id: 'o-andamento', name: 'Em andamento', pipeline_id: 'operacional' },
    { id: 'v-perdida', name: 'Venda Perdida', pipeline_id: 'vendas' },
  ];

  it('no mesmo funil da oportunidade', () => {
    expect(stageForStatus(etapas, 'operacional', 'em_andamento')?.id).toBe('o-andamento');
    expect(stageForStatus(etapas, 'vendas', 'cancelado')?.id).toBe('v-perdida');
    expect(stageForStatus(etapas, 'operacional', 'cancelado')).toBeNull();
  });

  it('ganho, perdido com "Pedido cancelado", e aberto', () => {
    expect(dealPatchForStatus('em_andamento', 's1')).toEqual({ order_status: 'em_andamento', stage_id: 's1', status: 'won' });
    expect(dealPatchForStatus('cancelado', null)).toEqual({ order_status: 'cancelado', status: 'lost', lost_reason: 'orderCanceled' });
    expect(dealPatchForStatus('compra_futura', 's2')).toMatchObject({ status: 'open' });
  });

  it('o arrasto: livre antes do lançamento; depois, só para a etapa da situação', () => {
    expect(dragAllowed({ orderStatus: 'em_aberto', accountsLaunchedAt: null, targetStageName: 'Follow-up' })).toBe(true);
    expect(dragAllowed({ orderStatus: 'em_andamento', accountsLaunchedAt: '2026-09-15', targetStageName: 'Follow-up' })).toBe(false);
    expect(dragAllowed({ orderStatus: 'em_andamento', accountsLaunchedAt: '2026-09-15', targetStageName: 'Em Andamento' })).toBe(true);
  });
});
