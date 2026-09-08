import { describe, expect, it } from 'vitest';

import { buildQuote, quoteFileName } from './quote';
import type { DealItemDraft } from '@/lib/products/catalog';

const SACO: DealItemDraft = {
  productId: 'p-1',
  name: 'Sacos para silagem 51x110 branco',
  quantity: 100,
  unitPrice: 4.25,
  discountPercent: 0,
};
const ABRACADEIRA: DealItemDraft = {
  productId: 'p-2',
  name: 'Abraçadeira plástica com UV preta',
  quantity: 200,
  unitPrice: 1,
  discountPercent: 10,
};

const BASE = {
  issuedOn: '2026-09-08',
  currency: 'BRL',
  company: 'PlastfortSul',
  customerName: 'Euclides Fernando Goncalves',
  items: [] as DealItemDraft[],
};

describe('buildQuote — a única conta do documento', () => {
  it('soma as linhas, e não o valor digitado', () => {
    // Item 46: com linhas, o número que alguém digitou antes é velho.
    const q = buildQuote({ ...BASE, items: [SACO], value: 999 });
    expect(q.products).toBe(425);
    expect(q.total).toBe(425);
  });

  it('usa o valor digitado quando não há linha nenhuma', () => {
    const q = buildQuote({ ...BASE, value: 625 });
    expect(q.products).toBe(625);
    expect(q.lines).toEqual([]);
  });

  it('aplica o desconto por linha', () => {
    const q = buildQuote({ ...BASE, items: [ABRACADEIRA] });
    expect(q.lines[0].total).toBe(180);
    expect(q.products).toBe(180);
  });

  it('o frete entra no total e fica separado dos produtos', () => {
    // Item 47: o documento mostra três linhas, e um valor que embutisse o
    // frete não sabe mais dizer quanto era cada parte.
    const q = buildQuote({
      ...BASE,
      items: [SACO, ABRACADEIRA],
      shipping: 120,
    });
    expect(q.products).toBe(605);
    expect(q.shipping).toBe(120);
    expect(q.total).toBe(725);
  });

  it('frete não definido não é frete zero', () => {
    const q = buildQuote({ ...BASE, items: [SACO] });
    expect(q.shipping).toBeNull();
    expect(q.total).toBe(425);
  });

  it('frete zero é uma decisão, e continua sendo zero', () => {
    const q = buildQuote({ ...BASE, items: [SACO], shipping: 0 });
    expect(q.shipping).toBe(0);
    expect(q.total).toBe(425);
  });

  it('não deixa centavo escapar em conta com quebra', () => {
    const q = buildQuote({
      ...BASE,
      items: [
        { ...SACO, quantity: 3, unitPrice: 3.33, discountPercent: 0 },
        { ...SACO, quantity: 3, unitPrice: 0.01, discountPercent: 0 },
      ],
      shipping: 0.03,
    });
    expect(q.products).toBe(10.02);
    expect(q.total).toBe(10.05);
  });

  it('o que está em branco vira ausência, e o documento omite ausências', () => {
    const q = buildQuote({
      ...BASE,
      orderNumber: '   ',
      carrier: '',
      owner: null,
      notes: '\n  \n',
      customerCompany: '  ',
    });
    expect(q.orderNumber).toBeNull();
    expect(q.carrier).toBeNull();
    expect(q.owner).toBeNull();
    expect(q.notes).toBeNull();
    expect(q.customer.company).toBeNull();
  });
});

describe('quoteFileName', () => {
  it('usa o número do pedido, que é como a operação chama o documento', () => {
    const q = buildQuote({ ...BASE, orderNumber: '14349' });
    expect(quoteFileName(q)).toBe('orcamento-14349');
  });

  it('sem número, a data e o cliente — sem acento e sem espaço', () => {
    const q = buildQuote(BASE);
    expect(quoteFileName(q)).toBe(
      'orcamento-2026-09-08-euclides-fernando-goncalves'
    );
  });

  it('nunca devolve um nome vazio', () => {
    const q = buildQuote({ ...BASE, customerName: '', issuedOn: '' });
    expect(quoteFileName(q)).toBe('orcamento-cliente');
  });
});
