import type { Reference } from './health';

/**
 * PESSOA DA EQUIPE ↔ VENDEDOR DO BLING (D8, 085).
 *
 * O vínculo é feito por um admin, na tela Equipe. O pedido leva o vendedor
 * do responsável pela oportunidade; sem vínculo, o pedido vai sem vendedor —
 * e a lista "Pronto para o Bling" não bloqueia por isso, porque o Bling
 * também não exige.
 */

export interface SellerLinkPatch {
  userId: string;
  sellerId: string | null;
}

export type SellerLinkValidation =
  | { ok: true; patch: SellerLinkPatch }
  | { ok: false; error: 'invalid_body' | 'unknown_seller' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Só vendedor vivo da empresa conectada; `null` desfaz o vínculo. */
export function validateSellerLink(
  corpo: unknown,
  referencias: ReadonlyArray<Reference>
): SellerLinkValidation {
  if (!corpo || typeof corpo !== 'object') return { ok: false, error: 'invalid_body' };
  const { userId, sellerId } = corpo as Record<string, unknown>;
  if (typeof userId !== 'string' || !UUID.test(userId)) return { ok: false, error: 'invalid_body' };
  if (sellerId === null) return { ok: true, patch: { userId, sellerId: null } };
  if (typeof sellerId !== 'string' || !sellerId.trim()) return { ok: false, error: 'invalid_body' };
  const vivo = referencias.some(
    (r) => r.kind === 'seller' && r.bling_id === sellerId && r.removed_at === null
  );
  if (!vivo) return { ok: false, error: 'unknown_seller' };
  return { ok: true, patch: { userId, sellerId } };
}

/** Os vendedores que a tela oferece: vivos, por nome. */
export function sellerOptions(referencias: ReadonlyArray<Reference>): Array<{ id: string; label: string; active: boolean }> {
  return referencias
    .filter((r) => r.kind === 'seller' && r.removed_at === null)
    .map((r) => ({ id: r.bling_id, label: r.label, active: r.active }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}
