import { describe, expect, it } from 'vitest';

import {
  categoryIdOf,
  checkInstallments,
  orderCategory,
  orderReadiness,
  orderWeight,
  snapshotMatches,
  type ProductFacts,
  type ReadinessInput,
} from './order-rules';

describe('orderWeight — peso = soma dos snapshots', () => {
  it('soma em gramas inteiros, com decimal', () => {
    // 3 × 0,105 kg em float é 0,31499999999999995.
    const r = orderWeight([
      { productId: 'p1', quantity: 3, unitGrossWeightKg: 0.105, blingProductType: 'P' },
      { productId: 'p2', quantity: 2.5, unitGrossWeightKg: 1.333, blingProductType: 'P' },
    ]);
    // 315 g + 3332,5 g → 3333 g (meio para longe do zero) = 3,648 kg
    expect(r.totalKg).toBe(3.648);
    expect(r.missing).toEqual([]);
  });

  it('produto físico sem peso pendura; serviço e texto livre não pesam', () => {
    const r = orderWeight([
      { productId: 'p1', quantity: 1, unitGrossWeightKg: null, blingProductType: 'P' },
      { productId: 'p2', quantity: 1, unitGrossWeightKg: null, blingProductType: 'S' },
      { productId: null, quantity: 1, unitGrossWeightKg: null },
      { productId: 'p3', quantity: 2, unitGrossWeightKg: undefined },
    ]);
    expect(r.missing).toEqual([0, 3]);
    expect(r.totalKg).toBe(0);
  });

  it('peso zero é resposta, não ausência', () => {
    expect(
      orderWeight([{ productId: 'p1', quantity: 5, unitGrossWeightKg: 0, blingProductType: 'P' }])
        .missing
    ).toEqual([]);
  });
});

describe('orderCategory — a regra do misto (abraçadeira + silagem)', () => {
  const silagem = { productId: 's', revenueCategoryBlingId: 'cat-silagem', definesOrderCategory: true };
  const lona = { productId: 'l', revenueCategoryBlingId: 'cat-lona', definesOrderCategory: true };
  const abracadeira = {
    productId: 'a',
    revenueCategoryBlingId: 'cat-acessorios',
    definesOrderCategory: false,
  };

  it('venda simples: automática', () => {
    expect(orderCategory([silagem, silagem], null)).toEqual({
      status: 'resolved',
      categoryId: 'cat-silagem',
      via: 'single',
    });
  });

  it('abraçadeira + silagem: o auxiliar não decide', () => {
    expect(categoryIdOf(orderCategory([abracadeira, silagem], null))).toBe('cat-silagem');
  });

  it('só auxiliares: elas decidem', () => {
    expect(orderCategory([abracadeira], null)).toEqual({
      status: 'resolved',
      categoryId: 'cat-acessorios',
      via: 'auxiliary',
    });
  });

  it('misto ambíguo exige decisão, e a escolha só vale entre as opções', () => {
    expect(orderCategory([silagem, lona], null)).toEqual({
      status: 'ambiguous',
      options: ['cat-silagem', 'cat-lona'],
    });
    expect(orderCategory([silagem, lona], 'cat-lona').status).toBe('chosen');
    expect(orderCategory([silagem, lona], 'cat-acessorios').status).toBe('ambiguous');
  });

  it('principal sem categoria deixa o pedido sem categoria', () => {
    expect(
      orderCategory([silagem, { productId: 'x', revenueCategoryBlingId: null }], null)
    ).toEqual({ status: 'missing', lines: [1] });
  });

  it('só texto livre: nada a decidir', () => {
    expect(orderCategory([{ productId: null }], null)).toEqual({ status: 'empty' });
  });
});

describe('checkInstallments', () => {
  it('fecha no centavo, com forma e vencimento', () => {
    const r = checkInstallments(
      [
        { amount: 33.33, dueOn: '2026-10-15', paymentMethodBlingId: '1' },
        { amount: 33.33, dueOn: '2026-11-14', paymentMethodBlingId: '1' },
        { amount: 33.34, dueOn: '2026-12-14', paymentMethodBlingId: '1' },
      ],
      10000,
      new Set(['1'])
    );
    expect(r.diffCents).toBe(0);
    expect(r.missingDue).toEqual([]);
    expect(r.methodNotAllowed).toEqual([]);
  });

  it('um centavo a menos não fecha; forma fora das confirmadas acusa', () => {
    const r = checkInstallments(
      [
        { amount: 33.33, dueOn: '2026-10-15', paymentMethodBlingId: '1' },
        { amount: 66.66, dueOn: null, paymentMethodBlingId: '7' },
      ],
      10000,
      new Set(['1'])
    );
    expect(r.diffCents).toBe(-1);
    expect(r.missingDue).toEqual([1]);
    expect(r.methodNotAllowed).toEqual([1]);
  });
});

describe('orderReadiness — a lista toda verde', () => {
  const base: ReadinessInput = {
    contact: {
      tax_id: '11222333000181',
      person_type: 'J',
      zip_code: '90000000',
      street: 'Rua de Teste',
      street_number: '100',
      district: 'Centro',
      city: 'Cidade Exemplo',
      state: 'RS',
      taxpayer_indicator: '9',
    },
    lines: [
      {
        productId: 'p1',
        blingProductId: 'b1',
        quantity: 2,
        unitGrossWeightKg: 1.5,
        blingProductType: 'P',
        revenueCategoryBlingId: 'cat',
        definesOrderCategory: true,
      },
    ],
    activeProductIds: new Set(['p1']),
    weightExceptionNote: null,
    chosenCategoryId: null,
    installments: [{ amount: 100, dueOn: '2026-10-15', paymentMethodBlingId: '1' }],
    totalCents: 10000,
    allowedPaymentMethods: new Set(['1']),
    carrier: { id: 'c1', active: true, is_customer_pickup: false, bling_contact_id: '99' },
  };

  it('um pedido preparado de ponta a ponta', () => {
    const r = orderReadiness(base);
    expect(r.items.filter((i) => !i.ok)).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it('cada falta acende só o seu item', () => {
    const semPeso = orderReadiness({
      ...base,
      lines: [{ ...base.lines[0], unitGrossWeightKg: null }],
    });
    expect(semPeso.items.filter((i) => !i.ok).map((i) => i.key)).toEqual(['weight']);

    const comExcecao = orderReadiness({
      ...base,
      lines: [{ ...base.lines[0], unitGrossWeightKg: null }],
      weightExceptionNote: 'autorizado pelo gerente',
    });
    expect(comExcecao.ready).toBe(true);

    const textoLivre = orderReadiness({
      ...base,
      lines: [...base.lines, { productId: null, quantity: 1 }],
    });
    expect(textoLivre.items.filter((i) => !i.ok).map((i) => i.key)).toEqual(['products']);

    const inativo = orderReadiness({ ...base, activeProductIds: new Set() });
    expect(inativo.unlinkedLines).toEqual([0]);

    // Catálogo ainda não carregado: o texto livre continua sem vínculo —
    // não é a checagem de "ativo" que o segura.
    const semCatalogo = orderReadiness({
      ...base,
      activeProductIds: null,
      lines: [...base.lines, { productId: null, quantity: 1 }],
    });
    expect(semCatalogo.unlinkedLines).toEqual([1]);

    const transportadoraSemBling = orderReadiness({
      ...base,
      carrier: { ...base.carrier!, bling_contact_id: null },
    });
    expect(transportadoraSemBling.items.find((i) => i.key === 'carrier')?.ok).toBe(false);

    const retira = orderReadiness({
      ...base,
      carrier: { id: 'c2', active: true, is_customer_pickup: true, bling_contact_id: null },
    });
    expect(retira.ready).toBe(true);

    const semCliente = orderReadiness({ ...base, contact: null });
    expect(semCliente.items.find((i) => i.key === 'customer')?.ok).toBe(false);

    const semParcelas = orderReadiness({ ...base, installments: [] });
    expect(semParcelas.items.filter((i) => !i.ok).map((i) => i.key)).toEqual([
      'payment',
      'installments',
    ]);
  });
});

describe('orderReadiness — o que a auditoria da 0.11.0 acrescentou', () => {
  const base: ReadinessInput = {
    contact: {
      tax_id: '11222333000181',
      person_type: 'J',
      zip_code: '90000000',
      street: 'Rua de Teste',
      street_number: '100',
      district: 'Centro',
      city: 'Cidade Exemplo',
      state: 'RS',
      taxpayer_indicator: '9',
    },
    lines: [
      {
        productId: 'p1',
        blingProductId: 'b1',
        quantity: 2,
        unitGrossWeightKg: 1.5,
        blingProductType: 'P',
        revenueCategoryBlingId: 'cat',
        definesOrderCategory: true,
      },
    ],
    activeProductIds: new Set(['p1']),
    weightExceptionNote: null,
    chosenCategoryId: null,
    installments: [{ amount: 100, dueOn: '2026-10-15', paymentMethodBlingId: '1' }],
    totalCents: 10000,
    allowedPaymentMethods: new Set(['1']),
    carrier: { id: 'c1', active: true, is_customer_pickup: false, bling_contact_id: '99' },
  };
  const produto: ProductFacts = {
    blingProductId: 'b1',
    blingProductType: 'P',
    revenueCategoryBlingId: 'cat',
    definesOrderCategory: true,
  };

  it('snapshot igual ao produto de agora: pronto', () => {
    const r = orderReadiness({ ...base, currentProducts: new Map([['p1', produto]]) });
    expect(r.ready).toBe(true);
    expect(r.staleLines).toEqual([]);
  });

  it('cada fato que muda no produto torna a linha velha', () => {
    for (const mudanca of [
      { blingProductId: 'b2' },
      { blingProductType: 'S' },
      { revenueCategoryBlingId: 'outra' },
      { definesOrderCategory: false },
    ] as Array<Partial<ProductFacts>>) {
      const r = orderReadiness({ ...base, currentProducts: new Map([['p1', { ...produto, ...mudanca }]]) });
      expect(r.staleLines).toEqual([0]);
      expect(r.unlinkedLines).toEqual([0]);
      expect(r.items.find((i) => i.key === 'products')?.ok).toBe(false);
    }
  });

  it('produto fora do mapa (inativo) é sem vínculo, mas não "velho"', () => {
    const r = orderReadiness({ ...base, activeProductIds: null, currentProducts: new Map() });
    expect(r.unlinkedLines).toEqual([0]);
    expect(r.staleLines).toEqual([]);
  });

  it('o motivo da transportadora', () => {
    expect(orderReadiness(base).carrierIssue).toBeNull();
    expect(orderReadiness({ ...base, carrier: null }).carrierIssue).toBe('missing');
    expect(orderReadiness({ ...base, carrier: { ...base.carrier!, active: false } }).carrierIssue).toBe('inactive');
    expect(orderReadiness({ ...base, carrier: { ...base.carrier!, bling_contact_id: null } }).carrierIssue).toBe('not_linked');
  });

  it('sem produto, a categoria leva à lista de produtos', () => {
    const r = orderReadiness({ ...base, lines: [] });
    expect(r.items.find((i) => i.key === 'category')?.field).toBe('deal-items');
    expect(orderReadiness(base).items.find((i) => i.key === 'category')?.field).toBe('deal-category');
  });
});

describe('snapshotMatches', () => {
  it('compara vínculo, tipo, categoria e "define a categoria"', () => {
    const linha = { productId: 'p1', quantity: 1, blingProductId: 'b1', blingProductType: null, revenueCategoryBlingId: 'c', definesOrderCategory: undefined };
    const fatos: ProductFacts = { blingProductId: 'b1', blingProductType: null, revenueCategoryBlingId: 'c', definesOrderCategory: true };
    expect(snapshotMatches(linha, fatos)).toBe(true);
    expect(snapshotMatches({ ...linha, definesOrderCategory: false }, fatos)).toBe(false);
  });
});
