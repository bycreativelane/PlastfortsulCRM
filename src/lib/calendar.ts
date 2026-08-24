/**
 * The calendar, as arithmetic.
 *
 * Extracted from `ui/date-field.tsx`, which owned all of this privately until
 * a second surface needed a month grid — the agenda on the dashboard. Two
 * copies of "which day does this month start on" is how two calendars in one
 * product end up disagreeing about whether the week starts on Sunday, so the
 * field and the agenda now compute their grids here and differ only in what
 * they draw inside a cell.
 *
 * Everything is LOCAL. Not a convenience: `new Date('2026-06-23')` is parsed
 * as UTC midnight, which is the previous day everywhere west of Greenwich —
 * the off-by-one that shows a deal closing on the 22nd. Every function that
 * takes or returns an ISO day here goes through `toISO` / `fromISO`, which
 * never touch the timezone.
 */

/** The three fields of a numeric date, in whatever order a locale writes them. */
export type DateOrder = 'day' | 'month' | 'year';

/** The order and separator this locale writes a numeric date in. */
export function localeDateShape(locale: string): {
  order: DateOrder[];
  separator: string;
} {
  const parts = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(2026, 0, 2));

  const order = parts
    .filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year')
    .map((p) => p.type as DateOrder);
  const separator = parts.find((p) => p.type === 'literal')?.value ?? '/';

  return {
    order: order.length === 3 ? order : ['day', 'month', 'year'],
    separator,
  };
}

/** ISO `YYYY-MM-DD` for a local date, with no timezone round-trip. */
export function toISO(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parse ISO `YYYY-MM-DD` as a LOCAL date. See the note at the top. */
export function fromISO(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * `n` months on from `date`, anchored to the FIRST of the month.
 *
 * Anchoring is the whole point: `setMonth(getMonth() + 1)` on the 31st of
 * January lands on the 2nd or 3rd of March, so a "next month" button pressed
 * from a 31-day month skips February entirely. A month cursor only ever needs
 * the month, so it only ever carries the first of it.
 */
export function addMonths(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

export function addDays(date: Date, n: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  return out;
}

/** Sunday for pt-BR, en-US and ko — but asked rather than assumed. */
export function firstDayOfWeek(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const week = info.getWeekInfo?.() ?? info.weekInfo;
    // The spec numbers days 1 (Monday) to 7 (Sunday); `Date` uses 0 (Sunday).
    if (week?.firstDay) return week.firstDay % 7;
  } catch {
    // Older engines: fall through.
  }
  return 0;
}

/**
 * Six rows, always — so a panel does not change height between a month that
 * fits in five and one that needs six, and so the grid drawn under a month
 * label is the same object every time it is redrawn.
 */
export const MONTH_GRID_DAYS = 42;

/**
 * The 42 days a month grid shows: the tail of the previous month, this one,
 * and the head of the next.
 */
export function monthMatrix(cursor: Date, weekStart: number): Date[] {
  const first = startOfMonth(cursor);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: MONTH_GRID_DAYS }, (_, i) => addDays(start, i));
}

/** The seven column headings, starting on this locale's first day. */
export function weekdayLabels(locale: string, weekStart: number): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  // 2026-02-01 is a Sunday, so index 0 of this walk is day 0.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(2026, 1, 1 + ((weekStart + i) % 7)))
  );
}
