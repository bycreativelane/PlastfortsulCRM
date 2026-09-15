import { describe, expect, it } from 'vitest';

import type { Installment } from '@/lib/deals/installments';
import type { DealItem } from '@/lib/products/catalog';

import { quoteInputFromRows } from './from-deal';
import { buildQuote } from './quote';

/*
 * O que o banco devolve, do jeito que ele devolve: NUMERIC pode vir como
 * texto, `freight_mode` pode ser o código ou a chave antiga, e as colunas
 * da 078 podem nem existir.
 */
const DEAL = {
  id: 'd-1',
  account_id: 'a-1',
  contact_id: 'c-1',
  assigned_to: 'p-1',
  sales_order_number: '10001',
  value: '1040.00',
  currency: 'BRL',
  shipping_cost: '80.00',
  carrier: 'Transportadora de exemplo',
  notes: 'Prazo de exemplo',
  payment_terms: '0',
  freight_mode: '0',
  freight_volumes: '3.000',
  gross_weight: '72.000',
  other_expenses: null,
  general_discount: '3.00',
  general_discount_unit: 'REAL',
};

const LINHA = (extra: Partial<DealItem>): DealItem => ({
  id: 'i',
  account_id: 'a-1',
  deal_id: 'd-1',
  product_id: 'p',
  name: 'Item',
  sku: null,
  unit: null,
  quantity: 1,
  unit_price: 0,
  discount_percent: 0,
  total: 0,
  position: 0,
  ...extra,
});

const ITENS: DealItem[] = [
  LINHA({
    name: 'Abraçadeira plástica com UV preta - 100 unidades',
    sku: 'ABR-UV-PT-100',
    unit: 'PCT',
    quantity: '8.000' as unknown as number,
    unit_price: '16.00' as unknown as number,
    discount_percent: '6.25' as unknown as number,
  }),
  LINHA({
    name: 'Sacos para silagem 51x110 branco - 100 unidades',
    sku: 'SIL-51110-BR-100',
    unit: 'PCT',
    quantity: 8,
    unit_price: 115,
    discount_percent: 0,
    position: 1,
  }),
];

const PARCELAS: Installment[] = [
  {
    id: 'x',
    account_id: 'a-1',
    deal_id: 'd-1',
    position: 0,
    days: 0,
    due_on: '2026-09-14',
    amount: '1117.00' as unknown as number,
    method: 'AGRO sicredi',
    note: null,
  },
];

const ROTULOS = { '0': 'CIF — remetente', '1': 'FOB — destinatário' };

const entrada = (extra: Partial<Parameters<typeof quoteInputFromRows>[0]> = {}) =>
  quoteInputFromRows({
    deal: DEAL,
    contact: { name: 'Cliente de exemplo', phone: '+5500000000000', company: null },
    items: ITENS,
    installments: PARCELAS,
    ownerName: 'Vendedor de exemplo',
    issuedOn: '2026-09-14',
    company: 'PlastfortSul',
    freightModeLabels: ROTULOS,
    ...extra,
  });

describe('quoteInputFromRows — o documento é o pedido gravado', () => {
  it('reproduz o pedido de exemplo a partir das linhas do banco', () => {
    const q = buildQuote(entrada());
    expect(q.lines.map((l) => l.total)).toEqual([120, 920]);
    expect(q.products).toBe(1040);
    expect(q.shipping).toBe(80);
    expect(q.discount?.amount).toBe(3);
    expect(q.total).toBe(1117);
    expect(q.installments.map((p) => p.amount)).toEqual([1117]);
  });

  it('NUMERIC em texto vira número, e ausência continua ausência', () => {
    const e = entrada();
    expect(e.freightVolumes).toBe(3);
    expect(e.grossWeight).toBe(72);
    expect(e.otherExpenses).toBeNull();
  });

  it('o frete por conta sai do CÓDIGO gravado, traduzido pelo mapa', () => {
    expect(entrada().freightMode).toBe('CIF — remetente');
  });

  it('a chave antiga (antes da 078) também acha o rótulo', () => {
    const e = entrada({ deal: { ...DEAL, freight_mode: 'freightFob' } });
    expect(e.freightMode).toBe('FOB — destinatário');
  });

  it('sem as colunas da 078 no banco, os campos novos ficam de fora', () => {
    const semA078 = { ...DEAL } as Record<string, unknown>;
    delete semA078.other_expenses;
    delete semA078.general_discount;
    delete semA078.general_discount_unit;
    const q = buildQuote(
      entrada({ deal: semA078 as unknown as typeof DEAL })
    );
    expect(q.discount).toBeNull();
    expect(q.otherExpenses).toBeNull();
    expect(q.total).toBe(1120);
  });

  it('cliente sem nome aparece pelo telefone', () => {
    const e = entrada({
      contact: { name: null, phone: '+5500000000000', company: null },
    });
    expect(e.customerName).toBe('+5500000000000');
  });

  it('sem contato, o documento não inventa cliente', () => {
    const e = entrada({ contact: null });
    expect(e.customerName).toBeNull();
    expect(e.customerPhone).toBeNull();
  });
});
