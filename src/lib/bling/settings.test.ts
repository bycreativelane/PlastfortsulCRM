import { describe, expect, it } from 'vitest';

import type { Reference } from './health';
import { buildReferenceOptions, describeSettingsChanges, validateSettingsPatch } from './settings';

const ref = (kind: string, bling_id: string, label: string, extra: Partial<Reference> = {}): Reference => ({
  kind,
  bling_id,
  parent_bling_id: null,
  label,
  active: true,
  removed_at: null,
  payload: {},
  ...extra,
});

const REFS: Reference[] = [
  ref('order_module', '500', 'Pedidos de Venda'),
  ref('order_status', '6', 'Em aberto', { parent_bling_id: '500' }),
  ref('order_status', '99', 'De outro módulo', { parent_bling_id: '501' }),
  ref('order_status', '15', 'Removida', { parent_bling_id: '500', removed_at: '2026-09-14T00:00:00Z' }),
  ref('revenue_category', '10', 'Venda direta', { payload: { tipo: 2 } }),
  ref('revenue_category', '20', 'Despesas', { payload: { tipo: 1 } }),
  ref('payment_method', '1', 'Pagamento a prazo', { payload: { destino: 1, finalidade: 2 } }),
];

describe('validateSettingsPatch — só id que está no Bling, vivo e do tipo certo', () => {
  it('aceita papéis existentes e null para desconfirmar', () => {
    expect(validateSettingsPatch({ status_open_id: '6', status_canceled_id: null, payment_method_ids: ['1', '1'] }, REFS)).toEqual({
      ok: true,
      patch: { status_open_id: '6', status_canceled_id: null, payment_method_ids: ['1'] },
    });
  });

  it('recusa id de outro tipo: a forma de pagamento "1" não é situação', () => {
    const r = validateSettingsPatch({ status_open_id: '1' }, REFS);
    expect(r.ok).toBe(false);
  });

  it('recusa id removido do Bling', () => {
    expect(validateSettingsPatch({ status_in_progress_id: '15' }, REFS).ok).toBe(false);
  });

  it('recusa campo desconhecido, corpo vazio e tipos errados', () => {
    expect(validateSettingsPatch({ company_id: 'x' }, REFS).ok).toBe(false);
    expect(validateSettingsPatch({}, REFS).ok).toBe(false);
    expect(validateSettingsPatch(null, REFS).ok).toBe(false);
    expect(validateSettingsPatch({ status_open_id: 6 }, REFS).ok).toBe(false);
    expect(validateSettingsPatch({ payment_method_ids: '1' }, REFS).ok).toBe(false);
    expect(validateSettingsPatch({ payment_method_ids: ['404'] }, REFS).ok).toBe(false);
  });
});

describe('describeSettingsChanges — a auditoria lê rótulos, não ids', () => {
  it('só o que mudou', () => {
    expect(
      describeSettingsChanges(
        { status_open_id: '6', payment_method_ids: [] },
        { status_open_id: '6', revenue_root_category_id: '10', payment_method_ids: ['1'] },
        REFS
      )
    ).toEqual({
      revenue_root_category_id: { from: null, to: 'Venda direta' },
      payment_method_ids: { from: null, to: 'Pagamento a prazo' },
    });
  });
});

describe('buildReferenceOptions', () => {
  it('situações só do módulo, sem as removidas; raízes só de receita', () => {
    const o = buildReferenceOptions(REFS, '500');
    expect(o.statuses.map((s) => s.id)).toEqual(['6']);
    expect(o.revenueRoots.map((c) => c.id)).toEqual(['10']);
    expect(o.paymentMethods[0]).toMatchObject({ id: '1', destination: 1, purpose: 2 });
  });
});
