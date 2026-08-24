import { describe, expect, it } from 'vitest';
import { CLOSING_HOURS, WINDOW_HOURS, sessionWindow } from './session-window';

// Local time on purpose: the whole calculation is a difference between two
// instants, so the zone is irrelevant — but building the fixtures with the
// date-only form would parse them as UTC and quietly shift every case by the
// runner's offset.
const NOW = new Date('2026-05-18T12:00:00');
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('sessionWindow', () => {
  it("is 'none' when the customer has never written", () => {
    // Not the same as expired: nothing lapsed, because nothing started.
    // An imported contact you have not heard from is in this state.
    for (const value of [null, undefined, '']) {
      expect(sessionWindow(value, NOW).state, String(value)).toBe('none');
    }
  });

  it("is 'none' rather than throwing on an unparseable timestamp", () => {
    expect(sessionWindow('not-a-date', NOW).state).toBe('none');
  });

  it('is open with plenty of time left', () => {
    const w = sessionWindow(hoursAgo(1), NOW);
    expect(w.state).toBe('open');
    expect(w.hoursLeft).toBe(WINDOW_HOURS - 1);
  });

  it('turns amber inside the closing window', () => {
    const w = sessionWindow(hoursAgo(WINDOW_HOURS - CLOSING_HOURS + 0.5), NOW);
    expect(w.state).toBe('closing');
  });

  it('is still open one minute before the closing window', () => {
    // The boundary matters: amber that starts early is amber that means
    // nothing by the time it counts.
    const justOutside = WINDOW_HOURS - CLOSING_HOURS - 1 / 60;
    expect(sessionWindow(hoursAgo(justOutside), NOW).state).toBe('open');
  });

  it('expires exactly at the window edge, not a moment before', () => {
    expect(sessionWindow(hoursAgo(WINDOW_HOURS - 0.001), NOW).state).toBe(
      'closing'
    );
    expect(sessionWindow(hoursAgo(WINDOW_HOURS), NOW).state).toBe('expired');
    expect(sessionWindow(hoursAgo(WINDOW_HOURS + 5), NOW).state).toBe(
      'expired'
    );
  });

  it('reports whole units, floored, and zeroes them once expired', () => {
    const w = sessionWindow(hoursAgo(20.75), NOW);
    expect(w.hoursLeft).toBe(3);
    expect(w.minutesLeft).toBe(195);

    const gone = sessionWindow(hoursAgo(30), NOW);
    expect(gone).toEqual({ state: 'expired', hoursLeft: 0, minutesLeft: 0 });
  });

  it('drops to zero hours in the final hour without expiring', () => {
    const w = sessionWindow(hoursAgo(WINDOW_HOURS - 0.5), NOW);
    expect(w.state).toBe('closing');
    expect(w.hoursLeft).toBe(0);
    expect(w.minutesLeft).toBe(30);
  });
});
