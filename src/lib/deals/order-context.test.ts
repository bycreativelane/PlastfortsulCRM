import { describe, expect, it } from 'vitest';

import type { Product } from '@/lib/products/catalog';
import { itemSnapshot } from '@/lib/products/catalog';

import { categoryResolver } from './order-context';

const PRODUTO = (extra: Partial<Product>): Product => ({
  id: 'p1',
  account_id: 'a1',
  name: 'Sacos para silagem 51x110',
  sku: 'SIL-51110',
  description: null,
  unit: 'PCT',
  price: 115,
  currency: 'BRL',
  category: null,
  active: true,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...extra,
});

describe('categoryResolver — a categoria que a linha congela', () => {
  const resolver = categoryResolver({
    references: [
      { kind: 'product_category', bling_id: 'fam-sacos', parent_bling_id: null, label: 'Sacos' },
      { kind: 'product_category', bling_id: 'fam-silagem', parent_bling_id: 'fam-sacos', label: 'Silagem' },
      { kind: 'product_category', bling_id: 'fam-200', parent_bling_id: 'fam-silagem', label: '200 micras' },
    ],
    familyCategories: [{ family_bling_id: 'fam-silagem', revenue_category_bling_id: 'cat-silagem' }],
    defaultCategoryId: 'cat-demais',
  });

  it('a família decide, subindo pelos pais', () => {
    expect(resolver(PRODUTO({ bling_family_id: 'fam-200' }))).toBe('cat-silagem');
  });

  it('a exceção do produto vence a família', () => {
    expect(
      resolver(PRODUTO({ bling_family_id: 'fam-200', revenue_category_bling_id: 'cat-lona' }))
    ).toBe('cat-lona');
  });

  it('sem mapa na árvore, a categoria padrão', () => {
    expect(resolver(PRODUTO({ bling_family_id: 'fam-sacos' }))).toBe('cat-demais');
  });
});

describe('itemSnapshot — o que a linha congela do produto', () => {
  it('preço de lista, peso, vínculo, tipo e categoria resolvida', () => {
    const snap = itemSnapshot(
      PRODUTO({
        price: 115,
        gross_weight_kg: '12.500' as unknown as number,
        bling_product_id: '16000001',
        bling_product_type: 'P',
        defines_order_category: false,
      }),
      () => 'cat-x'
    );
    expect(snap).toEqual({
      listPrice: 115,
      unitGrossWeightKg: 12.5,
      blingProductId: '16000001',
      revenueCategoryBlingId: 'cat-x',
      definesOrderCategory: false,
      blingProductType: 'P',
    });
  });

  it('texto livre limpa tudo — não há de onde tirar', () => {
    expect(itemSnapshot(null)).toEqual({
      listPrice: null,
      unitGrossWeightKg: null,
      blingProductId: null,
      revenueCategoryBlingId: null,
      definesOrderCategory: true,
      blingProductType: null,
    });
  });

  it('sem resolvedor, vale a exceção do próprio produto', () => {
    expect(itemSnapshot(PRODUTO({ revenue_category_bling_id: 'cat-y' })).revenueCategoryBlingId).toBe(
      'cat-y'
    );
  });
});
