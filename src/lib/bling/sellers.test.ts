import { describe, expect, it } from 'vitest';

import type { Reference } from './health';
import { sellerOptions, validateSellerLink } from './sellers';

const REF = (extra: Partial<Reference>): Reference => ({
  kind: 'seller',
  bling_id: '1',
  parent_bling_id: null,
  label: 'Vendedor',
  active: true,
  removed_at: null,
  payload: {},
  ...extra,
} as Reference);

const USER = '0b6c7c43-6f0a-4f59-9b0e-1f7f6f1b2a10';

describe('validateSellerLink', () => {
  const refs = [
    REF({ bling_id: '10', label: 'Beatriz' }),
    REF({ bling_id: '11', label: 'Antigo', removed_at: '2026-09-01T00:00:00Z' }),
    REF({ kind: 'payment_method', bling_id: '12', label: 'Pix' }),
  ];

  it('liga a vendedor vivo e desliga com null', () => {
    expect(validateSellerLink({ userId: USER, sellerId: '10' }, refs)).toEqual({
      ok: true,
      patch: { userId: USER, sellerId: '10' },
    });
    expect(validateSellerLink({ userId: USER, sellerId: null }, refs)).toEqual({
      ok: true,
      patch: { userId: USER, sellerId: null },
    });
  });

  it('recusa vendedor removido, id de outro tipo e corpo torto', () => {
    expect(validateSellerLink({ userId: USER, sellerId: '11' }, refs)).toEqual({
      ok: false,
      error: 'unknown_seller',
    });
    expect(validateSellerLink({ userId: USER, sellerId: '12' }, refs)).toEqual({
      ok: false,
      error: 'unknown_seller',
    });
    expect(validateSellerLink({ userId: 'x', sellerId: '10' }, refs)).toEqual({
      ok: false,
      error: 'invalid_body',
    });
    expect(validateSellerLink(null, refs)).toEqual({ ok: false, error: 'invalid_body' });
  });

  it('as opções são os vendedores vivos, por nome', () => {
    expect(
      sellerOptions([REF({ bling_id: '2', label: 'Zeca' }), REF({ bling_id: '3', label: 'Ana' }), ...refs]).map(
        (s) => s.label
      )
    ).toEqual(['Ana', 'Beatriz', 'Zeca']);
  });
});
