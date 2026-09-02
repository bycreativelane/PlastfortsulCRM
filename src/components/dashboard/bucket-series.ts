import type { ConversationsSeriesPoint } from '@/lib/dashboard/types';
import { APP_LOCALE } from '@/lib/i18n/locale';

/**
 * Daily points in, at most ~14 groups out.
 *
 * Its own module, and not a helper at the bottom of the chart, for one
 * reason: it is the only thing in this panel that can be WRONG WITHOUT
 * LOOKING WRONG. Every other decision there is visible — a colour, a
 * gap, a radius — and this one silently decides which days end up in
 * which bar. A chunking bug that drops the first day of a window
 * renders a perfectly plausible chart of the wrong numbers, and the
 * legend beside it would still read the correct total, because that is
 * summed off the raw points.
 *
 * So it is a pure function with no React and no Recharts in it, and
 * `bucket-series.test.ts` pins the invariant that matters: whatever the
 * unit, the buckets add up to the points.
 */

export type Unit = 'day' | 'week' | 'month';

export interface Bucket {
  key: string;
  /** Axis label — short. */
  label: string;
  /** Tooltip heading — the full range this bar covers. */
  heading: string;
  incoming: number;
  outgoing: number;
}

/**
 * Daily points in, at most ~14 bars out.
 *
 * The thresholds are about MARKS ON A PANEL, not about calendars: 14
 * groups of two is 28 bars, which is where a 690px plot stops being
 * readable at a glance. A 30-day window lands on weeks (5 groups) and a
 * 90-day window on months (3 or 4).
 */
export function bucketSeries(points: ConversationsSeriesPoint[]): {
  unit: Unit;
  buckets: Bucket[];
} {
  if (points.length <= 14) {
    return {
      unit: 'day',
      buckets: points.map((point) => ({
        key: point.day,
        label: shortDayLabel(point.day),
        heading: longDayLabel(point.day),
        incoming: point.incoming,
        outgoing: point.outgoing,
      })),
    };
  }

  if (points.length <= 70) return { unit: 'week', buckets: byWeek(points) };
  return { unit: 'month', buckets: byMonth(points) };
}

/**
 * Chunks of seven, cut from the most recent end.
 *
 * Cutting forward from the start leaves the PARTIAL chunk at the right,
 * which is the bar the eye goes to first and the one that would be
 * short for a reason that is not a drop in volume.
 */
function byWeek(points: ConversationsSeriesPoint[]): Bucket[] {
  const out: Bucket[] = [];
  for (let end = points.length; end > 0; end -= 7) {
    const chunk = points.slice(Math.max(0, end - 7), end);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    out.unshift({
      key: first.day,
      // The axis gets the START of the week; the tooltip gets both
      // ends. A label reading "4–10 ago" is two numbers wide at 10px
      // and collides with its neighbour at every width this panel has.
      label: shortDayLabel(first.day),
      heading: `${shortDayLabel(first.day)} – ${shortDayLabel(last.day)}`,
      incoming: chunk.reduce((n, p) => n + p.incoming, 0),
      outgoing: chunk.reduce((n, p) => n + p.outgoing, 0),
    });
  }
  return out;
}

/** Calendar months, keyed YYYY-MM so the order is the string order. */
function byMonth(points: ConversationsSeriesPoint[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const point of points) {
    const key = point.day.slice(0, 7);
    const bucket = map.get(key) ?? {
      key,
      label: monthLabel(point.day),
      heading: monthLabel(point.day, 'long'),
      incoming: 0,
      outgoing: 0,
    };
    bucket.incoming += point.incoming;
    bucket.outgoing += point.outgoing;
    map.set(key, bucket);
  }
  return [...map.values()];
}

// Dates are built from PARTS rather than parsed. `new Date('2026-08-01')`
// is UTC midnight, which is the previous day in every timezone west of
// Greenwich — and this product's users are all in one.
function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

function shortDayLabel(key: string): string {
  const [y, m, d] = parts(key);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
    month: 'short',
    day: 'numeric',
  });
}

function longDayLabel(key: string): string {
  const [y, m, d] = parts(key);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function monthLabel(key: string, month: 'short' | 'long' = 'short'): string {
  const [y, m, d] = parts(key);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
    month,
    year: 'numeric',
  });
}
