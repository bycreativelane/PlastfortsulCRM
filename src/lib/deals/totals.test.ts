import { describe, expect, it } from 'vitest';

import { linesTotalCents } from '@/lib/money';

import {
  discountExceedsOrder,
  discountUnit,
  orderTotals,
  shippingCountedTwice,
} from './totals';

/*
 * O pedido de exemplo da especificação de 14/09/2026, só com os NÚMEROS —
 * nada do cliente. Duas linhas, uma com desconto de item:
 *
 *   8 × R$ 16,00 com 6,25 %  = R$ 120,00  (preço praticado R$ 15,00)
 *   8 × R$ 115,00            = R$ 920,00
 *   frete R$ 80,00, desconto geral R$ 3,00 → total R$ 1.117,00
 */
const ITENS = [
  { quantity: 8, unitPrice: 16, discountPercent: 6.25 },
  { quantity: 8, unitPrice: 115, discountPercent: 0 },
];

describe('orderTotals — a fórmula do pedido de venda', () => {
  it('reproduz o pedido de exemplo no centavo', () => {
    const t = orderTotals({
      productsCents: linesTotalCents(ITENS),
      otherExpenses: 0,
      shipping: 80,
      generalDiscount: 3,
      generalDiscountUnit: 'REAL',
    });
    expect(t.productsCents).toBe(104000);
    expect(t.grossCents).toBe(112000);
    expect(t.discountCents).toBe(300);
    expect(t.totalCents).toBe(111700);
  });

  it('o desconto de ITEM não é subtraído de novo', () => {
    // Os R$ 8,00 de desconto da abraçadeira já estão nos R$ 120,00 da
    // linha. Sem desconto geral, o total é itens + frete, e ponto.
    const t = orderTotals({
      productsCents: linesTotalCents(ITENS),
      otherExpenses: null,
      shipping: 80,
      generalDiscount: null,
      generalDiscountUnit: 'REAL',
    });
    expect(t.totalCents).toBe(112000);
  });

  it('outras despesas entram antes do desconto', () => {
    const t = orderTotals({
      productsCents: 104000,
      otherExpenses: 25.5,
      shipping: 80,
      generalDiscount: 3,
      generalDiscountUnit: 'REAL',
    });
    expect(t.totalCents).toBe(104000 + 2550 + 8000 - 300);
  });

  it('em PERCENTUAL a base é a soma dos itens, não o total com frete', () => {
    const t = orderTotals({
      productsCents: 104000,
      otherExpenses: null,
      shipping: 80,
      generalDiscount: 10,
      generalDiscountUnit: 'PERCENTUAL',
    });
    expect(t.discountCents).toBe(10400);
    expect(t.totalCents).toBe(104000 + 8000 - 10400);
  });

  it('percentual arredonda o meio centavo como o banco', () => {
    // 2,5 % de R$ 0,33 = 0,00825 → 0,01
    const t = orderTotals({
      productsCents: 33,
      otherExpenses: null,
      shipping: null,
      generalDiscount: 2.5,
      generalDiscountUnit: 'PERCENTUAL',
    });
    expect(t.discountCents).toBe(1);
  });

  it('não informado e zero não descontam nada', () => {
    for (const generalDiscount of [null, 0]) {
      const t = orderTotals({
        productsCents: 5000,
        otherExpenses: null,
        shipping: null,
        generalDiscount,
        generalDiscountUnit: 'REAL',
      });
      expect(t.discountCents).toBe(0);
      expect(t.totalCents).toBe(5000);
    }
  });
});

describe('discountExceedsOrder', () => {
  it('acusa desconto maior que o pedido — não arredonda para caber', () => {
    const t = orderTotals({
      productsCents: 300,
      otherExpenses: null,
      shipping: null,
      generalDiscount: 300,
      generalDiscountUnit: 'REAL',
    });
    expect(t.totalCents).toBeLessThan(0);
    expect(discountExceedsOrder(t)).toBe(true);
  });

  it('desconto igual ao pedido é permitido (total zero é uma decisão)', () => {
    const t = orderTotals({
      productsCents: 300,
      otherExpenses: null,
      shipping: null,
      generalDiscount: 3,
      generalDiscountUnit: 'REAL',
    });
    expect(t.totalCents).toBe(0);
    expect(discountExceedsOrder(t)).toBe(false);
  });
});

describe('shippingCountedTwice — a linha "Frete" junto do campo de frete', () => {
  const livre = (name: string) => ({ productId: null, name });

  it('linha livre "Frete" com frete preenchido: avisa', () => {
    expect(shippingCountedTwice([livre('Frete')], 80)).toBe(true);
    expect(shippingCountedTwice([livre('  FRETE Braspress')], 80)).toBe(true);
  });

  it('sem valor no campo de frete, a linha é o frete — não há dobra', () => {
    expect(shippingCountedTwice([livre('Frete')], null)).toBe(false);
    expect(shippingCountedTwice([livre('Frete')], 0)).toBe(false);
  });

  it('produto de catálogo com "frete" no nome é cadastro, não engano', () => {
    expect(
      shippingCountedTwice([{ productId: 'p-1', name: 'Frete especial' }], 80)
    ).toBe(false);
  });

  it('"frete" no meio do nome não conta', () => {
    expect(shippingCountedTwice([livre('Saco com frete grátis')], 80)).toBe(
      false
    );
    expect(shippingCountedTwice([livre('Fretes antigos')], 80)).toBe(false);
  });
});

describe('discountUnit', () => {
  it('só PERCENTUAL é percentual; o resto é REAL', () => {
    expect(discountUnit('PERCENTUAL')).toBe('PERCENTUAL');
    expect(discountUnit('REAL')).toBe('REAL');
    expect(discountUnit(null)).toBe('REAL');
    expect(discountUnit('%')).toBe('REAL');
  });
});
