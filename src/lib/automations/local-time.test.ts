import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMEZONE,
  localParts,
  parseDateKey,
  parseHHmm,
  safeTimeZone,
  zonedTimeToUtc,
} from './local-time';

describe('localParts', () => {
  it('reads the wall clock of the zone, never the host', () => {
    // 01:30Z on the 2nd is still 22:30 on the 1st in São Paulo (UTC-3).
    const sp = localParts(
      new Date('2026-09-02T01:30:00Z'),
      'America/Sao_Paulo'
    );
    expect(sp.dateKey).toBe('2026-09-01');
    expect(sp.hour).toBe(22);
    expect(sp.minute).toBe(30);

    const utc = localParts(new Date('2026-09-02T01:30:00Z'), 'UTC');
    expect(utc.dateKey).toBe('2026-09-02');
    expect(utc.hour).toBe(1);
  });

  it('falls back to the default zone for a name the runtime rejects', () => {
    expect(safeTimeZone('Mars/Olympus_Mons')).toBe(DEFAULT_TIMEZONE);
    expect(safeTimeZone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(safeTimeZone('Asia/Seoul')).toBe('Asia/Seoul');
    expect(() => localParts(new Date(), 'Mars/Olympus_Mons')).not.toThrow();
  });
});

describe('parseHHmm', () => {
  it('accepts HH:mm and rejects the rest', () => {
    expect(parseHHmm('09:00')).toBe(540);
    expect(parseHHmm('9:05')).toBe(545);
    expect(parseHHmm('23:59')).toBe(1439);
    expect(parseHHmm('24:00')).toBeNull();
    expect(parseHHmm('09:60')).toBeNull();
    expect(parseHHmm('nine')).toBeNull();
    expect(parseHHmm('')).toBeNull();
    expect(parseHHmm(undefined)).toBeNull();
  });
});

describe('parseDateKey', () => {
  it('reads a DATE column value and nothing else', () => {
    expect(parseDateKey('2026-02-28')).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(parseDateKey('2026-13-01')).toBeNull();
    expect(parseDateKey('28/02/2026')).toBeNull();
    expect(parseDateKey(null)).toBeNull();
  });
});

describe('zonedTimeToUtc', () => {
  it('turns 09:00 in São Paulo into 12:00Z', () => {
    expect(
      zonedTimeToUtc('2026-09-02', 9 * 60, 'America/Sao_Paulo')?.toISOString()
    ).toBe('2026-09-02T12:00:00.000Z');
  });

  it('works east of UTC too', () => {
    expect(
      zonedTimeToUtc('2026-09-02', 9 * 60, 'Asia/Seoul')?.toISOString()
    ).toBe('2026-09-02T00:00:00.000Z');
  });

  it('is exact in UTC', () => {
    expect(zonedTimeToUtc('2026-09-02', 90, 'UTC')?.toISOString()).toBe(
      '2026-09-02T01:30:00.000Z'
    );
  });

  it('returns null for a non-date', () => {
    expect(zonedTimeToUtc('soon', 540, 'UTC')).toBeNull();
  });
});
