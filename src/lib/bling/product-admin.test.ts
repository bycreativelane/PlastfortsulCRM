import { describe, expect, it } from 'vitest';

import { fakeDb } from './fake-db';
import type { Reference } from './health';
import {
  buildFamilyRows,
  buildProductsCounts,
  parseMatchAction,
  resolveMatch,
  validateFamilyPatch,
  type CrmCatalogRow,
} from './product-admin';

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
  ref('revenue_category', 'raiz', 'Venda direta', { payload: { tipo: 2 } }),
  ref('revenue_category', 'silagem', 'Sacos para silagem', { parent_bling_id: 'raiz', payload: { tipo: 2 } }),
  ref('revenue_category', 'outros', 'Outros produtos', { parent_bling_id: 'raiz', payload: { tipo: 2 } }),
  ref('revenue_category', 'fora', 'Revenda', { payload: { tipo: 2 } }),
  ref('product_category', 'f-silagem', 'Sacos para silagem'),
  ref('product_category', 'f-200', '200 micras', { parent_bling_id: 'f-silagem' }),
  ref('product_category', 'f-lona', 'Lonas'),
];

const produto = (over: Partial<CrmCatalogRow>): CrmCatalogRow => ({
  id: 'p',
  name: 'P',
  sku: null,
  active: true,
  bling_product_id: 'b',
  bling_product_type: 'P',
  gross_weight_kg: 1,
  bling_family_id: null,
  revenue_category_bling_id: null,
  defines_order_category: true,
  ...over,
});

describe('buildProductsCounts', () => {
  it('sem peso só conta produto físico; sem categoria considera família, padrão e a raiz', () => {
    const catalogo = [
      produto({ id: '1', bling_family_id: 'f-200' }),
      produto({ id: '2', gross_weight_kg: null }),
      produto({ id: '3', gross_weight_kg: null, bling_product_type: 'S', bling_family_id: 'f-lona' }),
      produto({ id: '4', revenue_category_bling_id: 'fora' }),
      produto({ id: '5', defines_order_category: false, bling_family_id: 'f-silagem' }),
      produto({ id: '6', active: false }),
      produto({ id: '7', bling_product_id: null }),
    ];
    const counts = buildProductsCounts(catalogo, REFS, new Map([['f-silagem', 'silagem']]), {
      revenue_root_category_id: 'raiz',
      default_revenue_category_id: null,
    });
    expect(counts).toEqual({ linked: 6, active: 5, missingWeight: 1, unresolvedCategory: 3, auxiliary: 1 });
  });
});

describe('buildFamilyRows', () => {
  it('árvore com profundidade, contagem, mapa e sugestão pelo nome', () => {
    const linhas = buildFamilyRows(
      REFS,
      [produto({ id: '1', bling_family_id: 'f-200' }), produto({ id: '2', bling_family_id: 'f-200' })],
      new Map([['f-lona', 'fora']]),
      'raiz'
    );
    expect(linhas.map((l) => [l.label, l.depth, l.productCount, l.mappingState, l.suggestion?.id ?? null])).toEqual([
      ['Lonas', 0, 0, 'outside_root', null],
      ['Sacos para silagem', 0, 0, null, 'silagem'],
      ['200 micras', 1, 2, null, null],
    ]);
  });
});

describe('validateFamilyPatch', () => {
  it('só família do cache e categoria embaixo da raiz; null desfaz', () => {
    expect(validateFamilyPatch({ mappings: [{ familyId: 'f-lona', categoryId: 'outros' }, { familyId: 'f-200', categoryId: null }] }, REFS, 'raiz')).toEqual({
      ok: true,
      mappings: [
        { familyId: 'f-lona', categoryId: 'outros' },
        { familyId: 'f-200', categoryId: null },
      ],
    });
    expect(validateFamilyPatch({ mappings: [{ familyId: 'f-lona', categoryId: 'fora' }] }, REFS, 'raiz').ok).toBe(false);
    expect(validateFamilyPatch({ mappings: [{ familyId: 'nao-existe', categoryId: 'outros' }] }, REFS, 'raiz').ok).toBe(false);
    expect(validateFamilyPatch({ mappings: [{ familyId: 'f-lona', categoryId: 'outros' }] }, REFS, null).ok).toBe(false);
    expect(validateFamilyPatch({ mappings: [] }, REFS, 'raiz').ok).toBe(false);
  });
});

describe('parseMatchAction', () => {
  it('link exige produto; o resto é recusado', () => {
    expect(parseMatchAction({ action: 'link', productId: 'p-1' })).toEqual({ action: 'link', productId: 'p-1' });
    expect(parseMatchAction({ action: 'link' })).toBeNull();
    expect(parseMatchAction({ action: 'create' })).toEqual({ action: 'create' });
    expect(parseMatchAction({ action: 'apagar' })).toBeNull();
  });
});

describe('resolveMatch', () => {
  const pendencia = {
    id: 'm-1',
    account_id: 'acc-1',
    bling_product_id: '20',
    bling_code: 'COD-20',
    status: 'pending',
    payload: { name: 'Produto do Bling', price: 10, active: true, type: 'P', grossWeightKg: 2 },
  };

  it('vincula a um produto existente e fecha a pendência', async () => {
    const db = fakeDb({
      tables: {
        bling_product_matches: [{ ...pendencia }],
        products: [{ id: 'p-1', account_id: 'acc-1', name: 'Antigo', sku: null, bling_product_id: null }],
      },
    });
    const r = await resolveMatch(db.client, { accountId: 'acc-1', userId: 'u', matchId: 'm-1' }, { action: 'link', productId: 'p-1' });
    expect(r).toEqual({ ok: true, productId: 'p-1' });
    expect(db.tables.products[0]).toMatchObject({ bling_product_id: '20', sku: 'COD-20', gross_weight_kg: 2, name: 'Produto do Bling' });
    expect(db.tables.bling_product_matches[0]).toMatchObject({ status: 'linked', resolved_by: 'u' });
  });

  it('recusa vincular a produto que já é de outro id do Bling', async () => {
    const db = fakeDb({
      tables: {
        bling_product_matches: [{ ...pendencia }],
        products: [{ id: 'p-1', account_id: 'acc-1', name: 'Outro', bling_product_id: '999' }],
      },
    });
    const r = await resolveMatch(db.client, { accountId: 'acc-1', userId: 'u', matchId: 'm-1' }, { action: 'link', productId: 'p-1' });
    expect(r).toEqual({ ok: false, status: 409, error: 'product_linked_elsewhere' });
    expect(db.tables.bling_product_matches[0].status).toBe('pending');
  });

  it('cria sem código quando o código já tem dono', async () => {
    const db = fakeDb({
      tables: {
        bling_product_matches: [{ ...pendencia }],
        products: [{ id: 'p-dono', account_id: 'acc-1', name: 'Dono', sku: 'cod-20', bling_product_id: '777' }],
      },
    });
    const r = await resolveMatch(db.client, { accountId: 'acc-1', userId: 'u', matchId: 'm-1' }, { action: 'create' });
    expect(r.ok).toBe(true);
    const criado = db.tables.products.find((p) => p.bling_product_id === '20');
    expect(criado).toMatchObject({ sku: null, account_id: 'acc-1', created_by: 'u' });
  });

  it('pendência de outra conta não existe; resolvida não resolve de novo', async () => {
    const db = fakeDb({ tables: { bling_product_matches: [{ ...pendencia, status: 'ignored' }], products: [] } });
    expect(await resolveMatch(db.client, { accountId: 'acc-2', userId: 'u', matchId: 'm-1' }, { action: 'ignore' })).toMatchObject({ status: 404 });
    expect(await resolveMatch(db.client, { accountId: 'acc-1', userId: 'u', matchId: 'm-1' }, { action: 'ignore' })).toMatchObject({ status: 409 });
  });
});
