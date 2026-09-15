import { describe, expect, it } from 'vitest';

import { ordersEnableBlockers } from './orders-flag';

describe('ordersEnableBlockers', () => {
  const pronto = {
    company_id: 'emp-1',
    status_open_id: '6',
    revenue_root_category_id: '900',
    payment_method_ids: ['7001'],
  };

  it('configuração mínima confirmada: pode ligar', () => {
    expect(ordersEnableBlockers(pronto, 'emp-1')).toEqual([]);
  });

  it('sem papéis, ou com os de outra empresa, não liga', () => {
    expect(ordersEnableBlockers(null, 'emp-1')).toEqual(['no_settings']);
    expect(ordersEnableBlockers(pronto, 'emp-2')).toEqual(['company_mismatch']);
  });

  it('cada falta aparece', () => {
    expect(
      ordersEnableBlockers({ company_id: 'emp-1', status_open_id: null, revenue_root_category_id: null, payment_method_ids: [] }, 'emp-1')
    ).toEqual(['no_open_status', 'no_revenue_root', 'no_payment_methods']);
  });
});
