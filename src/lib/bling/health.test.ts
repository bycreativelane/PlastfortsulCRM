import { describe, expect, it } from 'vitest';

import { buildHealth, foldName, type BlingSettingsRow, type Reference } from './health';

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

/** Um Bling configurado como a especificação descreve, com ids inventados. */
function blingCompleto(): Reference[] {
  const modulo = '500';
  const s = (id: string, nome: string) => ref('order_status', id, nome, { parent_bling_id: modulo });
  const t = (id: string, de: string, para: string, acoes: string[] = []) =>
    ref('order_transition', id, `${de} → ${para}`, { parent_bling_id: modulo, payload: { from_id: de, to_id: para, action_ids: acoes } });
  return [
    ref('order_module', modulo, 'Pedidos de Venda', { payload: { nome: 'Vendas', descricao: 'Pedidos de Venda' } }),
    ref('order_module', '501', 'Pedidos de Compra', { payload: { nome: 'Compras', descricao: 'Pedidos de Compra' } }),
    s('6', 'Em aberto'),
    s('15', 'Em Andamento'),
    s('9', 'Atendido'),
    s('12', 'Cancelado'),
    s('77', 'Compra futura'),
    ref('order_action', '1', 'Lançar contas', { parent_bling_id: modulo }),
    t('100', '6', '15', ['1']),
    t('101', '15', '9'),
    t('102', '6', '77'),
    t('103', '77', '6'),
    t('104', '6', '12'),
    t('105', '15', '12'),
    ref('revenue_category', '10', 'Venda direta', { payload: { tipo: 2 } }),
    ref('revenue_category', '11', 'Sacos de lixo', { parent_bling_id: '10', payload: { tipo: 2 } }),
    ref('revenue_category', '12', 'Outros produtos', { parent_bling_id: '10', payload: { tipo: 2 }, active: false }),
    ref('revenue_category', '20', 'Despesas gerais', { payload: { tipo: 1 } }),
    ref('payment_method', '1', 'Pagamento a prazo', { payload: { destino: 1, finalidade: 2 } }),
    ref('payment_method', '2', 'Dinheiro', { payload: { destino: 3, finalidade: 3 } }),
    ref('contact_type', '3', 'Cliente'),
    ref('seller', '5', 'Vendedora'),
  ];
}

const CONFIRMADO: BlingSettingsRow = {
  company_id: 'empresa-a',
  order_module_id: '500',
  status_open_id: '6',
  status_in_progress_id: '15',
  status_fulfilled_id: '9',
  status_canceled_id: '12',
  status_future_purchase_id: '77',
  revenue_root_category_id: '10',
  payment_method_ids: ['1'],
};

describe('buildHealth', () => {
  it('sem nada confirmado: sugere pelo nome e não conta como pronto', () => {
    const h = buildHealth(blingCompleto(), null, 'empresa-a');
    expect(h.orderModule).toMatchObject({ state: 'unconfirmed', suggestion: { id: '500' } });
    // Sem acento e sem caixa: "Em Andamento" casa com "em andamento".
    expect(h.statuses.in_progress).toMatchObject({ state: 'unconfirmed', suggestion: { id: '15' } });
    expect(h.revenueRoot.suggestion?.id).toBe('10');
    expect(h.transitions.every((t) => t.state === 'unmapped')).toBe(true);
    expect(h.green).toBe(false);
  });

  it('tudo confirmado e configurado: verde, com as ações de cada transição', () => {
    const h = buildHealth(blingCompleto(), CONFIRMADO, 'empresa-a');
    expect(h.green).toBe(true);
    expect(h.pending).toBe(0);
    expect(h.transitions.find((t) => t.from === 'open' && t.to === 'in_progress')?.actions).toEqual(['Lançar contas']);
    expect(h.revenueCategories.map((c) => [c.label, c.state])).toEqual([
      ['Outros produtos', 'inactive'],
      ['Sacos de lixo', 'ok'],
    ]);
  });

  it('Compra futura que não existe na conta: "missing", e a transição fica sem mapa', () => {
    const semCompraFutura = blingCompleto().filter((r) => r.bling_id !== '77');
    const h = buildHealth(semCompraFutura, { ...CONFIRMADO, status_future_purchase_id: null }, 'empresa-a');
    expect(h.statuses.future_purchase.state).toBe('missing');
    expect(h.transitions.find((t) => t.to === 'future_purchase')?.state).toBe('unmapped');
    expect(h.green).toBe(false);
  });

  it('confirmado mas removido do Bling é vermelho, não esquecido', () => {
    const refs = blingCompleto().map((r) => (r.bling_id === '15' && r.kind === 'order_status' ? { ...r, removed_at: '2026-09-15T00:00:00Z' } : r));
    const h = buildHealth(refs, CONFIRMADO, 'empresa-a');
    expect(h.statuses.in_progress).toMatchObject({ state: 'removed', confirmed: { id: '15', label: 'Em Andamento' } });
  });

  it('transição inativa ou ausente não é verde', () => {
    const refs = blingCompleto()
      .map((r) => (r.bling_id === '101' ? { ...r, active: false } : r))
      .filter((r) => r.bling_id !== '105');
    const h = buildHealth(refs, CONFIRMADO, 'empresa-a');
    expect(h.transitions.find((t) => t.from === 'in_progress' && t.to === 'fulfilled')?.state).toBe('inactive');
    expect(h.transitions.find((t) => t.from === 'in_progress' && t.to === 'canceled')?.state).toBe('missing');
    expect(h.green).toBe(false);
  });

  it('forma de pagamento sem destino Conta a receber não serve para Contas a Receber', () => {
    const h = buildHealth(blingCompleto(), { ...CONFIRMADO, payment_method_ids: ['1', '2'] }, 'empresa-a');
    expect(h.paymentMethods.map((p) => [p.label, p.state])).toEqual([
      ['Pagamento a prazo', 'ok'],
      ['Dinheiro', 'incompatible'],
    ]);
    expect(h.green).toBe(false);
  });

  it('categoria de DESPESA como raiz é incompatível', () => {
    const h = buildHealth(blingCompleto(), { ...CONFIRMADO, revenue_root_category_id: '20' }, 'empresa-a');
    expect(h.revenueRoot.state).toBe('incompatible');
  });

  it('papéis de outra empresa não valem: tudo volta a confirmar', () => {
    const h = buildHealth(blingCompleto(), { ...CONFIRMADO, company_id: 'empresa-b' }, 'empresa-a');
    expect(h.settingsFromOtherCompany).toBe(true);
    expect(h.statuses.open.state).toBe('unconfirmed');
    expect(h.paymentMethods).toEqual([]);
  });

  it('sem o tipo de contato Cliente, não é verde', () => {
    const h = buildHealth(blingCompleto().filter((r) => r.kind !== 'contact_type'), CONFIRMADO, 'empresa-a');
    expect(h.customerContactType).toBe(false);
    expect(h.green).toBe(false);
  });
});

describe('foldName', () => {
  it('tira acento, caixa e espaço sobrando', () => {
    expect(foldName('  Em   ANDAMENTO ')).toBe('em andamento');
    expect(foldName('Sacolas Boca de Palhaço')).toBe('sacolas boca de palhaco');
  });
});
