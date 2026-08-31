import { describe, it, expect } from 'vitest';

import { localDayKey } from './date-utils';
import {
  MAX_PERIOD_DAYS,
  dayKeysBetween,
  parseDayKey,
  periodFromDates,
  periodFromPreset,
  periodInputValues,
  previousPeriod,
} from './period';

/**
 * A reporting window is the kind of thing that is wrong by one day for
 * months before anybody notices, because every number it produces still
 * looks like a number. So the boundaries get asserted, not eyeballed.
 */

// A fixed "now": Wednesday 12 August 2026, 09:30 local.
const NOW = new Date(2026, 7, 12, 9, 30, 0, 0);

describe('parseDayKey', () => {
  it('reads a date input value as the start of a local day', () => {
    const d = parseDayKey('2026-07-01')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
  });

  it('refuses a day that does not exist', () => {
    // `new Date(2026, 1, 31)` silently becomes 3 March, which would make
    // a typo into a valid window over the wrong month.
    expect(parseDayKey('2026-02-31')).toBeNull();
    expect(parseDayKey('2026-13-01')).toBeNull();
    expect(parseDayKey('01/07/2026')).toBeNull();
    expect(parseDayKey('')).toBeNull();
  });
});

describe('periodFromPreset', () => {
  it('covers exactly N local days, ending now', () => {
    const p = periodFromPreset(30, NOW);
    expect(p.days).toBe(30);
    expect(localDayKey(p.from)).toBe('2026-07-14'); // 29 days before the 12th
    expect(p.from.getHours()).toBe(0);
    expect(p.to.getTime()).toBe(NOW.getTime());
    expect(p.preset).toBe(30);
  });

  it('7 days means today plus the six before it', () => {
    const p = periodFromPreset(7, NOW);
    expect(dayKeysBetween(p.from, p.to)).toEqual([
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);
  });

  it('gives each preset its own cache key', () => {
    const keys = [7, 30, 90].map((d) => periodFromPreset(d as 7, NOW).key);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('periodFromDates', () => {
  it('a whole month includes its last day', () => {
    const r = periodFromDates('2026-07-01', '2026-07-31', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.period.days).toBe(31);
    // THE OFF-BY-ONE THIS TYPE EXISTS FOR: `to` is the start of 1 August,
    // so an event at 23:59 on the 31st is inside the window.
    expect(localDayKey(r.period.to)).toBe('2026-08-01');
    expect(r.period.to.getHours()).toBe(0);
    expect(r.period.preset).toBeNull();
  });

  it('a single day is one day, not zero', () => {
    const r = periodFromDates('2026-07-15', '2026-07-15', NOW);
    expect(r.ok && r.period.days).toBe(1);
  });

  it('clamps a window that runs past now, so no empty tail is drawn', () => {
    // "This month", picked on the 12th.
    const r = periodFromDates('2026-08-01', '2026-08-31', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.period.to.getTime()).toBe(NOW.getTime());
    expect(r.period.days).toBe(12); // the 1st through today
  });

  it('refuses a reversed pair rather than quietly swapping it', () => {
    // Swapping would show a window the operator did not ask for and give
    // them no reason to look at the control again.
    const r = periodFromDates('2026-07-31', '2026-07-01', NOW);
    expect(r).toEqual({ ok: false, reason: 'reversed' });
  });

  it('refuses a window that starts in the future', () => {
    expect(periodFromDates('2026-09-01', '2026-09-30', NOW)).toEqual({
      ok: false,
      reason: 'future',
    });
  });

  it('refuses a window longer than the cap', () => {
    const r = periodFromDates('2020-01-01', '2026-08-12', NOW);
    expect(r).toEqual({ ok: false, reason: 'tooLong' });
  });

  it('accepts a window exactly at the cap', () => {
    const from = new Date(NOW);
    from.setDate(from.getDate() - (MAX_PERIOD_DAYS - 1));
    const r = periodFromDates(localDayKey(from), localDayKey(NOW), NOW);
    expect(r.ok && r.period.days).toBe(MAX_PERIOD_DAYS);
  });

  it('refuses an unparseable value', () => {
    expect(periodFromDates('', '2026-07-31', NOW).ok).toBe(false);
    expect(periodFromDates('2026-07-01', 'ontem', NOW).ok).toBe(false);
  });

  it('gives two different windows two different keys', () => {
    const a = periodFromDates('2026-07-01', '2026-07-31', NOW);
    const b = periodFromDates('2026-06-01', '2026-06-30', NOW);
    expect(a.ok && b.ok && a.period.key === b.period.key).toBe(false);
  });

  /**
   * A clamped window keeps the key the OPERATOR chose, not the clamped
   * end — otherwise "this month" would get a new cache key every time the
   * clock moved, and re-fetch on every render.
   */
  it('keys a clamped window by what was asked for', () => {
    const a = periodFromDates('2026-08-01', '2026-08-31', NOW);
    const later = new Date(2026, 7, 12, 17, 0, 0, 0);
    const b = periodFromDates('2026-08-01', '2026-08-31', later);
    expect(a.ok && b.ok && a.period.key).toBe(b.ok ? b.period.key : null);
  });
});

describe('previousPeriod', () => {
  it('is exactly as long as the window it compares against', () => {
    const p = periodFromPreset(30, NOW);
    const prev = previousPeriod(p);
    expect(prev.to.getTime() - prev.from.getTime()).toBe(
      p.to.getTime() - p.from.getTime()
    );
  });

  /**
   * THE BUG THIS RULE EXISTS FOR. The visible window ends at 09:30, so it
   * is 29 days and 9.5 hours. Comparing it against 30 whole days would
   * report a fall of about a third of a day's traffic, every morning,
   * from the clock alone.
   */
  it('does not compare a part-day window against a whole-day one', () => {
    const p = periodFromPreset(30, NOW);
    const prev = previousPeriod(p);

    // Ends exactly where the visible window begins — exclusive.
    expect(prev.to.getTime()).toBe(p.from.getTime());

    // The naive version: the 30 whole calendar days before the window.
    // It would be LONGER than what is on screen, by the hours elapsed
    // today, and every morning would report a fall made of nothing.
    const naive = new Date(p.from);
    naive.setDate(naive.getDate() - 30);
    expect(prev.from.getTime()).toBeGreaterThan(naive.getTime());

    // Asserted as a duration rather than a wall clock, so a machine that
    // crosses a DST boundary between June and August still agrees.
    expect(p.from.getTime() - prev.from.getTime()).toBe(
      p.to.getTime() - p.from.getTime()
    );
  });

  it('works the same for a hand-picked window', () => {
    const r = periodFromDates('2026-07-01', '2026-07-31', NOW);
    if (!r.ok) throw new Error('unreachable');
    const prev = previousPeriod(r.period);
    expect(prev.to.getTime()).toBe(r.period.from.getTime());
    expect(localDayKey(prev.from)).toBe('2026-05-31'); // 31 days before 1 July
  });
});

describe('dayKeysBetween', () => {
  it('excludes the upper bound', () => {
    const from = new Date(2026, 6, 1);
    const to = new Date(2026, 6, 4);
    expect(dayKeysBetween(from, to)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
  });

  it('is empty when the bounds are equal', () => {
    const d = new Date(2026, 6, 1);
    expect(dayKeysBetween(d, d)).toEqual([]);
  });

  it('does not spin on a reversed pair', () => {
    expect(dayKeysBetween(new Date(2026, 6, 10), new Date(2026, 6, 1))).toEqual(
      []
    );
  });
});

describe('periodInputValues', () => {
  it('round-trips a hand-picked window', () => {
    const r = periodFromDates('2026-07-01', '2026-07-31', NOW);
    if (!r.ok) throw new Error('unreachable');
    expect(periodInputValues(r.period)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('shows a preset as the days it actually covers', () => {
    // Not the exclusive `to`, which is a mid-day instant — the operator
    // reads the control as "1 July to 31 July", never "to 1 August".
    expect(periodInputValues(periodFromPreset(7, NOW))).toEqual({
      from: '2026-08-06',
      to: '2026-08-12',
    });
  });
});
