import { describe, expect, it } from 'vitest';

import {
  OFFLINE_AFTER_MS,
  derivePresence,
  formatLastSeen,
  presenceLabel,
  summarize,
} from './presence';

// Fixed reference clock so every case is deterministic.
const NOW = new Date('2026-06-22T12:00:00.000Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('derivePresence', () => {
  it('returns the stored status for a fresh heartbeat', () => {
    expect(derivePresence('online', ago(1_000), NOW)).toBe('online');
    expect(derivePresence('away', ago(1_000), NOW)).toBe('away');
  });

  it('reads as offline when the heartbeat is stale', () => {
    expect(derivePresence('online', ago(OFFLINE_AFTER_MS + 1_000), NOW)).toBe(
      'offline'
    );
    // Stored 'away' goes stale to offline too (tab was closed while idle).
    expect(derivePresence('away', ago(OFFLINE_AFTER_MS + 1_000), NOW)).toBe(
      'offline'
    );
  });

  it('treats a missing row or timestamp as offline', () => {
    expect(derivePresence(undefined, null, NOW)).toBe('offline');
    expect(derivePresence('online', null, NOW)).toBe('offline');
    expect(derivePresence('online', 'not-a-date', NOW)).toBe('offline');
  });

  it('stays online exactly at the threshold and flips just past it', () => {
    expect(derivePresence('online', ago(OFFLINE_AFTER_MS), NOW)).toBe('online');
    expect(derivePresence('online', ago(OFFLINE_AFTER_MS + 1), NOW)).toBe(
      'offline'
    );
  });
});

describe('formatLastSeen', () => {
  // These used to assert English literals, which is exactly how nine of
  // them survived in an app that is otherwise entirely in Portuguese. The
  // assertions are on SHAPE now — coarse, suffixed, and in the
  // installation's locale — because the words belong to `dateLocale` and
  // pinning them here would re-freeze the bug one layer up.
  it("describes recent activity coarsely and in the app's locale", () => {
    expect(formatLastSeen(ago(10_000), NOW)).toMatch(/menos de um minuto/i);
    expect(formatLastSeen(ago(5 * 60_000), NOW)).toMatch(/5 minutos/);
  });

  it('rolls up into hours and days', () => {
    expect(formatLastSeen(ago(2 * 60 * 60_000), NOW)).toMatch(/2 horas/);
    expect(formatLastSeen(ago(3 * 24 * 60 * 60_000), NOW)).toMatch(/3 dias/);
  });

  it('suffixes every answer, so it reads as a moment in the past', () => {
    expect(formatLastSeen(ago(5 * 60_000), NOW)).toMatch(/^há /);
  });

  it('never reports the future', () => {
    // A clock skewed forward on one machine would otherwise produce
    // "em 3 minutos" next to a grey dot.
    expect(formatLastSeen(ago(-5 * 60_000), NOW)).not.toMatch(/^em /);
  });

  it('falls back gracefully on missing/invalid input', () => {
    // No date at all and an unparseable one give the same coarse answer,
    // in the app's language — not the English literal this used to return.
    expect(formatLastSeen(null, NOW)).toMatch(/^há /);
    expect(formatLastSeen('nonsense', NOW)).toMatch(/^há /);
  });
});

describe('presenceLabel', () => {
  // A translator stub, shaped like `useTranslations('Presence')`. Asserting
  // on the KEY rather than on English prose is the point of the change:
  // these three used to be string literals baked into a lib file, and a
  // test pinning the literals is what let them survive.
  const t = (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key;

  it('asks the catalogue for each state', () => {
    expect(presenceLabel('online', ago(1_000), NOW, t)).toBe('labelOnline');
    expect(presenceLabel('away', ago(1_000), NOW, t)).toBe('labelAway');
  });

  it('hands the relative time to the offline label', () => {
    const label = presenceLabel('offline', ago(2 * 60 * 60_000), NOW, t);
    expect(label).toMatch(/^labelOffline:/);
    expect(label).toMatch(/2 horas/);
  });
});

describe('summarize', () => {
  it('counts each status', () => {
    expect(
      summarize(['online', 'online', 'online', 'away', 'offline'])
    ).toEqual({ online: 3, away: 1, offline: 1 });
  });

  it('returns zeroes for an empty roster', () => {
    expect(summarize([])).toEqual({ online: 0, away: 0, offline: 0 });
  });
});
