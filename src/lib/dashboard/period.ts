import { localDayKey, startOfLocalDay } from './date-utils';

/**
 * The window a report is about.
 *
 * ------------------------------------------------------------------
 * WHY THIS REPLACES A NUMBER
 * ------------------------------------------------------------------
 *
 * Relatórios had `7 | 30 | 90`, and every query took that number and
 * counted backwards from today. Which answers "how are we doing lately"
 * and cannot answer "how was July" — the request was "falta uma opção
 * para selecionar período específico para análise", and a period ending
 * in the past is not expressible as a count of days back from now.
 *
 * So a period is two instants. The presets still exist and still mean
 * exactly what they meant; they are now one way of producing the pair
 * rather than the only shape a window can have.
 *
 * ------------------------------------------------------------------
 * `to` IS EXCLUSIVE, AND THAT IS THE WHOLE BUG CLASS
 * ------------------------------------------------------------------
 *
 * "1 to 31 July" as a half-open range is `[Jul 1 00:00, Aug 1 00:00)`.
 * Written closed — `<= Jul 31` — it silently drops everything that
 * happened on the 31st after midnight, which is the 31st. Every
 * boundary here is half-open for that reason, and the constructor is
 * the only place that has to know it.
 *
 * ------------------------------------------------------------------
 * AND THE COMPARISON IS ALWAYS EQUAL-LENGTH
 * ------------------------------------------------------------------
 *
 * `previousPeriod` measures in elapsed time, never in calendar days.
 * The preset window runs to NOW, so at nine in the morning "30 days" is
 * 29 whole days plus two hours; comparing that against 30 whole days
 * reports a double-digit fall that is nothing but the clock. This was
 * already understood in `loadConversationsPrevious` — it moves here so
 * a hand-picked window gets the same treatment for free.
 */

export const PRESETS = [7, 30, 90] as const;
export type PresetDays = (typeof PRESETS)[number];

/**
 * The longest hand-picked window.
 *
 * `loadConversationsSeries` pulls every message in the window and
 * buckets it in the browser. A year is already a lot of rows for a busy
 * account; five would be a page that never finishes and a tab that runs
 * out of memory, from a control that looks like it costs nothing.
 * Refusing with a sentence beats appearing to hang.
 */
export const MAX_PERIOD_DAYS = 366;

export interface Period {
  /** Inclusive. Always the start of a local day. */
  from: Date;
  /** EXCLUSIVE. `now` for a preset; the start of the day after the last. */
  to: Date;
  /** Which preset produced this, or null when it was picked by hand. */
  preset: PresetDays | null;
  /** Whole local days the window covers. Always at least 1. */
  days: number;
  /** Stable identity, for caching a fetch against the window it answered. */
  key: string;
}

export type PeriodResult =
  | { ok: true; period: Period }
  | { ok: false; reason: 'invalid' | 'reversed' | 'tooLong' | 'future' };

/** `YYYY-MM-DD` → the start of that local day, or null. */
export function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  // Rejects 2026-02-31, which `new Date` would happily roll into March.
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return startOfLocalDay(date);
}

/** Local days spanned by `[from, to)`. At least 1 for any non-empty window. */
function dayCount(from: Date, to: Date): number {
  return Math.max(1, dayKeysBetween(from, to).length);
}

/** The last N days, ending now. What the preset chips produce. */
export function periodFromPreset(
  preset: PresetDays,
  now: Date = new Date()
): Period {
  const from = startOfLocalDay(now);
  from.setDate(from.getDate() - (preset - 1));
  return {
    from,
    to: new Date(now),
    preset,
    days: preset,
    key: `p${preset}`,
  };
}

/**
 * A hand-picked window, from two `YYYY-MM-DD` values.
 *
 * Both ends are inclusive as the operator reads them — picking 1 and 31
 * July means all of July — and the exclusive `to` is computed here so no
 * caller has to remember the off-by-one.
 */
export function periodFromDates(
  fromKey: string,
  toKey: string,
  now: Date = new Date()
): PeriodResult {
  const from = parseDayKey(fromKey);
  const last = parseDayKey(toKey);
  if (!from || !last) return { ok: false, reason: 'invalid' };
  if (last.getTime() < from.getTime()) return { ok: false, reason: 'reversed' };

  // Exclusive: the day after the last day the operator picked.
  const exclusive = new Date(last);
  exclusive.setDate(exclusive.getDate() + 1);

  const today = startOfLocalDay(now);
  if (from.getTime() > today.getTime()) return { ok: false, reason: 'future' };

  // A window whose end is in the future is not an error — "this month",
  // picked on the 12th, is the ordinary way to ask — but it must not
  // draw twenty empty days. Clamped to now, so the chart ends where the
  // data does.
  const to = exclusive.getTime() > now.getTime() ? new Date(now) : exclusive;

  const days = dayCount(from, to);
  if (days > MAX_PERIOD_DAYS) return { ok: false, reason: 'tooLong' };

  return {
    ok: true,
    period: {
      from,
      to,
      preset: null,
      days,
      key: `c${localDayKey(from)}_${localDayKey(last)}`,
    },
  };
}

/**
 * The window immediately before, exactly as long.
 *
 * Exclusive at the top: an event on the boundary belongs to the period
 * being reported, not to the one it is measured against.
 */
export function previousPeriod(period: Period): { from: Date; to: Date } {
  const span = period.to.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - span),
    to: new Date(period.from),
  };
}

/**
 * Every local-day key in `[from, to)`, chronological.
 *
 * Walks by calendar day rather than by adding 86.4e6 ms, so the two
 * days a year that are 23 or 25 hours long produce one key each.
 */
export function dayKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = startOfLocalDay(from);
  // A guard, not a limit: the callers are bounded by MAX_PERIOD_DAYS, and
  // this stops a reversed pair from spinning forever.
  let guard = 0;
  while (cursor.getTime() < to.getTime() && guard < MAX_PERIOD_DAYS * 2) {
    keys.push(localDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return keys;
}

/** The `<input type="date">` value for a period's ends, as the operator reads them. */
export function periodInputValues(period: Period): { from: string; to: string } {
  // `to` is exclusive and may be a mid-day "now", so the last day the
  // operator would name is the day containing the instant just before it.
  const lastMoment = new Date(period.to.getTime() - 1);
  return { from: localDayKey(period.from), to: localDayKey(lastMoment) };
}
