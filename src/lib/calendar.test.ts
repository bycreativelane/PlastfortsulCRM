import { describe, expect, it } from 'vitest';

import {
  MONTH_GRID_DAYS,
  addDays,
  addMonths,
  firstDayOfWeek,
  fromISO,
  isSameDay,
  localeDateShape,
  monthMatrix,
  startOfMonth,
  toISO,
  weekdayLabels,
} from './calendar';

describe('toISO / fromISO', () => {
  it('round-trips a local date without a timezone shift', () => {
    const date = new Date(2026, 5, 23, 23, 30);
    expect(toISO(date)).toBe('2026-06-23');
    expect(fromISO('2026-06-23')?.getDate()).toBe(23);
  });

  it('parses ISO as LOCAL midnight, not UTC', () => {
    // `new Date('2026-06-23')` is UTC midnight — the previous day west of
    // Greenwich. This is the bug the helper exists to prevent.
    const parsed = fromISO('2026-06-23');
    expect(parsed?.getHours()).toBe(0);
    expect(toISO(parsed as Date)).toBe('2026-06-23');
  });

  it('reads the date half of a timestamp and rejects nonsense', () => {
    expect(fromISO('2026-06-23T18:45:00Z')?.getMonth()).toBe(5);
    expect(fromISO('not a date')).toBeNull();
    expect(fromISO('')).toBeNull();
  });

  it('pads single-digit months and days', () => {
    expect(toISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('isSameDay', () => {
  it('compares the calendar day, not the instant', () => {
    expect(isSameDay(new Date(2026, 7, 23, 1), new Date(2026, 7, 23, 23))).toBe(
      true
    );
    expect(isSameDay(new Date(2026, 7, 23), new Date(2027, 7, 23))).toBe(false);
  });
});

describe('addMonths', () => {
  it('anchors to the first, so a 31-day month cannot skip February', () => {
    const next = addMonths(new Date(2026, 0, 31), 1);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(1);
  });

  it('crosses year boundaries in both directions', () => {
    expect(toISO(addMonths(new Date(2026, 11, 15), 1))).toBe('2027-01-01');
    expect(toISO(addMonths(new Date(2026, 0, 15), -1))).toBe('2025-12-01');
  });
});

describe('addDays / startOfMonth', () => {
  it('does not mutate its input', () => {
    const date = new Date(2026, 7, 23);
    addDays(date, 10);
    expect(date.getDate()).toBe(23);
  });

  it('walks across a month boundary', () => {
    expect(toISO(addDays(new Date(2026, 7, 30), 3))).toBe('2026-09-02');
  });

  it('startOfMonth keeps the month and drops the day', () => {
    expect(toISO(startOfMonth(new Date(2026, 7, 23)))).toBe('2026-08-01');
  });
});

describe('firstDayOfWeek', () => {
  it('is Sunday for the locales this app ships', () => {
    expect(firstDayOfWeek('pt-BR')).toBe(0);
    expect(firstDayOfWeek('en-US')).toBe(0);
  });

  it('falls back to Sunday for an unparseable tag', () => {
    expect(firstDayOfWeek('not-a-locale!!')).toBe(0);
  });
});

describe('monthMatrix', () => {
  it('is always six rows', () => {
    expect(monthMatrix(new Date(2026, 1, 1), 0)).toHaveLength(MONTH_GRID_DAYS);
    // February 2027 starts on a Monday and has 28 days — five rows of content.
    expect(monthMatrix(new Date(2027, 1, 1), 0)).toHaveLength(MONTH_GRID_DAYS);
  });

  it('starts on the week day it was asked for', () => {
    expect(monthMatrix(new Date(2026, 7, 1), 0)[0].getDay()).toBe(0);
    expect(monthMatrix(new Date(2026, 7, 1), 1)[0].getDay()).toBe(1);
  });

  it('leads in with the tail of the previous month', () => {
    // 1 August 2026 is a Saturday, so a Sunday-first grid opens on 26 July.
    expect(toISO(monthMatrix(new Date(2026, 7, 1), 0)[0])).toBe('2026-07-26');
  });

  it('contains every day of the month it is drawing', () => {
    const grid = monthMatrix(new Date(2026, 7, 15), 0).map(toISO);
    for (let day = 1; day <= 31; day++) {
      expect(grid).toContain(toISO(new Date(2026, 7, day)));
    }
  });

  it('runs in unbroken single-day steps', () => {
    const grid = monthMatrix(new Date(2026, 9, 1), 0);
    for (let i = 1; i < grid.length; i++) {
      const gap = grid[i].getTime() - grid[i - 1].getTime();
      // Not exactly 86 400 000 everywhere: a DST change makes a day 23 or 25
      // hours long, and the grid must survive it.
      expect(gap).toBeGreaterThanOrEqual(22 * 3_600_000);
      expect(gap).toBeLessThanOrEqual(26 * 3_600_000);
    }
  });
});

describe('weekdayLabels', () => {
  it('returns seven, rotated to the requested first day', () => {
    const sundayFirst = weekdayLabels('en-US', 0);
    const mondayFirst = weekdayLabels('en-US', 1);
    expect(sundayFirst).toHaveLength(7);
    expect(mondayFirst[0]).toBe(sundayFirst[1]);
    expect(mondayFirst[6]).toBe(sundayFirst[0]);
  });
});

describe('localeDateShape', () => {
  it('reads day-first for pt-BR and month-first for en-US', () => {
    expect(localeDateShape('pt-BR').order).toEqual(['day', 'month', 'year']);
    expect(localeDateShape('en-US').order).toEqual(['month', 'day', 'year']);
  });

  it('always returns three fields and a separator', () => {
    const shape = localeDateShape('ko');
    expect(shape.order).toHaveLength(3);
    expect(shape.separator.length).toBeGreaterThan(0);
  });
});
