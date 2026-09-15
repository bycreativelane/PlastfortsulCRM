import { describe, expect, it } from 'vitest';

import { categoriesUnderRoot, isUnderRoot, resolveProductCategory, suggestFamilyCategory } from './categories';
import type { Reference } from './health';

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

describe('resolveProductCategory — exceção, família (subindo), padrão', () => {
  const mapa = new Map([['fam-silagem', 'cat-silagem']]);
  const pais = new Map<string, string | null>([
    ['fam-silagem', 'fam-sacos'],
    ['fam-200mic', 'fam-silagem'],
    ['fam-sacos', null],
  ]);

  it('a exceção do produto vence', () => {
    expect(resolveProductCategory({ revenue_category_bling_id: 'cat-x', bling_family_id: 'fam-silagem' }, mapa, pais, 'cat-outros')).toEqual({
      categoryId: 'cat-x',
      source: 'product',
      familyId: null,
    });
  });

  it('sem mapa na família, herda do ancestral mapeado', () => {
    expect(resolveProductCategory({ revenue_category_bling_id: null, bling_family_id: 'fam-200mic' }, mapa, pais, 'cat-outros')).toEqual({
      categoryId: 'cat-silagem',
      source: 'family',
      familyId: 'fam-silagem',
    });
  });

  it('nada mapeado na cadeia: cai no padrão; sem padrão, nulo', () => {
    expect(resolveProductCategory({ revenue_category_bling_id: null, bling_family_id: 'fam-sacos' }, mapa, pais, 'cat-outros').source).toBe('default');
    expect(resolveProductCategory({ revenue_category_bling_id: null, bling_family_id: null }, mapa, pais, null)).toEqual({
      categoryId: null,
      source: null,
      familyId: null,
    });
  });

  it('um ciclo na árvore do cache não trava', () => {
    const ciclo = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(resolveProductCategory({ revenue_category_bling_id: null, bling_family_id: 'a' }, new Map(), ciclo, 'p').source).toBe('default');
  });
});

describe('isUnderRoot e categoriesUnderRoot', () => {
  const refs = [
    ref('revenue_category', 'raiz', 'Venda direta'),
    ref('revenue_category', 'filha', 'Sacos de lixo', { parent_bling_id: 'raiz' }),
    ref('revenue_category', 'neta', 'Pretos', { parent_bling_id: 'filha' }),
    ref('revenue_category', 'outra', 'Revenda', {}),
    ref('revenue_category', 'removida', 'Velha', { parent_bling_id: 'raiz', removed_at: '2026-09-01T00:00:00Z' }),
  ];
  const pai = new Map(refs.map((r) => [r.bling_id, r.parent_bling_id]));

  it('a cadeia de pais termina na raiz', () => {
    expect(isUnderRoot('neta', 'raiz', pai)).toBe(true);
    expect(isUnderRoot('outra', 'raiz', pai)).toBe(false);
  });

  it('lista as vivas embaixo da raiz, sem a raiz', () => {
    expect(categoriesUnderRoot(refs, 'raiz').map((c) => c.bling_id).sort()).toEqual(['filha', 'neta']);
    expect(categoriesUnderRoot(refs, null)).toEqual([]);
  });
});

describe('suggestFamilyCategory', () => {
  const sob = [ref('revenue_category', 'c1', 'Sacolas Boca de palhaço'), ref('revenue_category', 'c2', 'Sacos de lixo', { active: false })];

  it('mesmo nome sem acento e caixa', () => {
    expect(suggestFamilyCategory('Sacolas boca de palhaco', sob)).toEqual({ id: 'c1', label: 'Sacolas Boca de palhaço' });
  });

  it('categoria inativa não é sugerida, e nome diferente não é adivinhado', () => {
    expect(suggestFamilyCategory('Sacos de lixo', sob)).toBeNull();
    expect(suggestFamilyCategory('Saco de lixo', sob)).toBeNull();
  });
});
