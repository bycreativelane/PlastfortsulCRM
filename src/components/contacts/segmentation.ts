/**
 * The Contatos segmentation filters.
 *
 * These all live on `contacts` itself, which is what lets them compose into
 * the page's existing paginated query instead of needing their own RPC. The
 * tag filter stays where it is, on `filter_contacts_by_tags` (migration 025) —
 * it needs a join, a distinct and a windowed count, and folding it in here
 * would mean either an IN clause that can overflow or a second RPC.
 *
 * Keeping them separate has a consequence worth naming: with a tag selected,
 * the page runs the RPC path and these do not apply. The UI says so rather
 * than showing a number quietly computed from half the filters.
 */

export type PurchaseState = 'any' | 'bought' | 'never';

export interface Segmentation {
  purchase: PurchaseState;
  /** Bought, but not in this many days. 0 = no constraint. */
  idleDays: number;
  city: string | null;
  state: string | null;
  /** Exclude contacts who asked us to stop. On by default — see below. */
  excludeOptedOut: boolean;
}

export const EMPTY_SEGMENTATION: Segmentation = {
  purchase: 'any',
  idleDays: 0,
  city: null,
  state: null,
  // Defaults to ON. Every audience this screen produces is destined for a
  // broadcast or an automation, and both must exclude opted-out contacts;
  // making the safe setting the one you have to remember to switch on is how
  // somebody messages a person who asked them not to.
  excludeOptedOut: true,
};

/** Days-idle options the picker offers. */
export const IDLE_OPTIONS = [0, 30, 60, 90] as const;

export function isSegmentationActive(s: Segmentation): boolean {
  return countSegmentationFilters(s) > 0;
}

/**
 * How many conditions the operator actually set.
 *
 * Exists because a phone cannot afford to show the panel. Below `lg` the
 * five controls collapse behind one button, and a collapsed filter that
 * does not say how much it is filtering is how somebody ends up looking
 * at 9 of 400 contacts and calling the list broken. The button carries
 * this number.
 *
 * Same rule as the boolean it now backs: excluding opt-outs is the
 * default, so leaving it on is not something the user narrowed.
 */
export function countSegmentationFilters(s: Segmentation): number {
  let n = 0;
  if (s.purchase !== 'any') n += 1;
  if (s.idleDays > 0) n += 1;
  if (s.city) n += 1;
  if (s.state) n += 1;
  if (s.excludeOptedOut !== EMPTY_SEGMENTATION.excludeOptedOut) n += 1;
  return n;
}

/** ISO date `days` before today, for a `last_purchase_at <` comparison. */
export function idleCutoff(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Minimal shape of the PostgREST builder this needs, so the composition can
 * be unit-tested without a Supabase client or a network.
 */
export interface FilterTarget<T> {
  eq(column: string, value: unknown): T;
  is(column: string, value: unknown): T;
  not(column: string, operator: string, value: unknown): T;
  lt(column: string, value: unknown): T;
}

/**
 * Apply the segmentation to a query.
 *
 * Order is irrelevant to PostgREST (they AND together), but it is written
 * cheapest-first for readability: the two equality filters, then the null
 * checks, then the date comparison.
 */
export function applySegmentation<T extends FilterTarget<T>>(
  query: T,
  s: Segmentation,
  now: Date = new Date()
): T {
  let q = query;

  if (s.excludeOptedOut) q = q.eq('opted_out', false);
  if (s.state) q = q.eq('state', s.state);
  if (s.city) q = q.eq('city', s.city);

  if (s.purchase === 'never') {
    q = q.is('last_purchase_at', null);
  } else if (s.purchase === 'bought') {
    q = q.not('last_purchase_at', 'is', null);
  }

  // "Idle for N days" implies they bought at some point — a contact who never
  // bought is not idle, they are new. Without the NOT NULL the date
  // comparison would silently drop them anyway (NULL < date is NULL), but
  // stating it keeps the intent readable and survives a Postgres that treats
  // it differently.
  if (s.idleDays > 0) {
    q = q.not('last_purchase_at', 'is', null);
    q = q.lt('last_purchase_at', idleCutoff(s.idleDays, now));
  }

  return q;
}
