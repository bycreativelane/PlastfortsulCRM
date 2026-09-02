import { describe, expect, it } from 'vitest';

import { bucketSeries } from './bucket-series';
import type { ConversationsSeriesPoint } from '@/lib/dashboard/types';

/**
 * The invariant this file exists for: BUCKETING MUST NOT CHANGE A TOTAL.
 *
 * The conversations panel stopped drawing one bar per day when the
 * window grew past a fortnight — thirty days times two series is sixty
 * marks, which is noise — so it now sums days into weeks or months. That
 * is a chunking loop with two off-by-one opportunities in it (where a
 * chunk starts, and which end the remainder lands on), and a chunking
 * bug here is the worst kind available: it renders a perfectly plausible
 * chart of the wrong numbers.
 *
 * It is also invisible from the panel. The legend's totals are summed
 * off the RAW points, deliberately, so a bucketing bug would leave the
 * headline number correct while the bars under it disagreed with it —
 * and nobody adds up five bars to check.
 */

/** `n` days from 2026-08-01, each carrying its own index as the count. */
function series(n: number): ConversationsSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(2026, 7, 1 + i);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(day.getDate()).padStart(2, '0')}`;
    // Distinct per day and never zero, so a dropped or double-counted
    // day changes the sum. A constant would hide a swap.
    return { day: key, incoming: i + 1, outgoing: (i + 1) * 2 };
  });
}

function sum(points: ConversationsSeriesPoint[]) {
  return {
    incoming: points.reduce((n, p) => n + p.incoming, 0),
    outgoing: points.reduce((n, p) => n + p.outgoing, 0),
  };
}

describe('bucketSeries', () => {
  it('picks the unit from the number of points, not from the calendar', () => {
    expect(bucketSeries(series(1)).unit).toBe('day');
    expect(bucketSeries(series(14)).unit).toBe('day');
    expect(bucketSeries(series(15)).unit).toBe('week');
    expect(bucketSeries(series(70)).unit).toBe('week');
    expect(bucketSeries(series(71)).unit).toBe('month');
  });

  it('keeps one bucket per point at day resolution', () => {
    const points = series(14);
    const { buckets } = bucketSeries(points);
    expect(buckets).toHaveLength(14);
    expect(buckets.map((b) => b.key)).toEqual(points.map((p) => p.day));
  });

  it.each([15, 21, 28, 30, 45, 70, 71, 90, 120])(
    'conserves both totals across %i points',
    (n) => {
      const points = series(n);
      const { buckets } = bucketSeries(points);
      expect(sum(points)).toEqual({
        incoming: buckets.reduce((acc, b) => acc + b.incoming, 0),
        outgoing: buckets.reduce((acc, b) => acc + b.outgoing, 0),
      });
    }
  );

  it('cuts weeks from the most recent end, leaving the short one first', () => {
    // 30 days is 4 whole weeks and 2 days. The partial chunk has to be
    // the OLDEST one: put it on the right and the last bar on the chart
    // — the one everybody reads first — is short for a reason that is
    // not a drop in volume.
    const { buckets } = bucketSeries(series(30));
    expect(buckets).toHaveLength(5);
    expect(buckets[0].key).toBe('2026-08-01');
    // First bucket = days 1–2, so incoming is 1 + 2.
    expect(buckets[0].incoming).toBe(3);
    // Last bucket ends on the last point, which is what makes "the week
    // you are in" the rightmost bar.
    expect(buckets.at(-1)!.incoming).toBe(
      series(30)
        .slice(23)
        .reduce((n, p) => n + p.incoming, 0)
    );
  });

  it('groups months in chronological order across a year boundary', () => {
    const points = Array.from({ length: 75 }, (_, i) => {
      const day = new Date(2026, 10, 20 + i); // 20 Nov 2026 onwards
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(day.getDate()).padStart(2, '0')}`;
      return { day: key, incoming: 1, outgoing: 1 };
    });
    const { unit, buckets } = bucketSeries(points);
    expect(unit).toBe('month');
    expect(buckets.map((b) => b.key)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(buckets.reduce((n, b) => n + b.incoming, 0)).toBe(75);
  });

  it('never emits two buckets under one axis label', () => {
    // Recharts keys its categories on the rendered label. Two buckets
    // sharing one would be silently merged into a single column.
    for (const n of [14, 15, 30, 70, 90]) {
      const labels = bucketSeries(series(n)).buckets.map((b) => b.label);
      expect(new Set(labels).size, `${n} points`).toBe(labels.length);
    }
  });

  it('returns nothing for an empty window rather than a zero bar', () => {
    expect(bucketSeries([]).buckets).toEqual([]);
  });
});
