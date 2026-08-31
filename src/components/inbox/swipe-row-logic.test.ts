import { describe, expect, it } from 'vitest';

import {
  COMMIT_PX,
  MAX_PX,
  START_PX,
  isSwipeStarted,
  swipeOffset,
  swipeOutcome,
  type SwipeAbilities,
} from './swipe-row-logic';

const BOTH: SwipeAbilities = { canArchive: true, canMarkUnread: true };
const NEITHER: SwipeAbilities = { canArchive: false, canMarkUnread: false };
const ARCHIVE_ONLY: SwipeAbilities = { canArchive: true, canMarkUnread: false };
const UNREAD_ONLY: SwipeAbilities = { canArchive: false, canMarkUnread: true };

describe('swipeOffset', () => {
  it('follows the finger in both directions', () => {
    expect(swipeOffset(-40, BOTH)).toBe(-40);
    expect(swipeOffset(40, BOTH)).toBe(40);
  });

  it('stops at the backdrop width so the row never outruns its label', () => {
    expect(swipeOffset(-500, BOTH)).toBe(-MAX_PX);
    expect(swipeOffset(500, BOTH)).toBe(MAX_PX);
  });

  it('refuses to move towards an action that is not available', () => {
    // Left is Ocultar. With nothing to hide, the row stays put rather
    // than opening onto a backdrop that would do nothing.
    expect(swipeOffset(-100, UNREAD_ONLY)).toBe(0);
    // Right is Não lida — unavailable on a row that is already unread.
    expect(swipeOffset(100, ARCHIVE_ONLY)).toBe(0);
  });

  it('is inert for an account that cannot write', () => {
    expect(swipeOffset(-120, NEITHER)).toBe(0);
    expect(swipeOffset(120, NEITHER)).toBe(0);
  });

  it('treats zero as the right-hand direction and yields nothing there', () => {
    // A guard against a sign bug: `dx < 0` picks archive, so exactly 0
    // must land on the unread branch and clamp to itself either way.
    expect(swipeOffset(0, BOTH)).toBe(0);
    expect(swipeOffset(0, ARCHIVE_ONLY)).toBe(0);
  });
});

describe('swipeOutcome', () => {
  it('commits exactly at the threshold, not one pixel past it', () => {
    expect(swipeOutcome(-COMMIT_PX, BOTH)).toBe('archive');
    expect(swipeOutcome(COMMIT_PX, BOTH)).toBe('unread');
  });

  it('springs back just short of the threshold', () => {
    expect(swipeOutcome(-COMMIT_PX + 1, BOTH)).toBeNull();
    expect(swipeOutcome(COMMIT_PX - 1, BOTH)).toBeNull();
  });

  it('does nothing for a small nudge', () => {
    expect(swipeOutcome(-5, BOTH)).toBeNull();
    expect(swipeOutcome(0, BOTH)).toBeNull();
    expect(swipeOutcome(12, BOTH)).toBeNull();
  });

  it('re-checks the ability at release, not only at drag start', () => {
    // The row was draggable when the finger went down; a realtime patch
    // arrived mid-gesture and took the action away. Releasing must not
    // perform it.
    expect(swipeOutcome(-MAX_PX, UNREAD_ONLY)).toBeNull();
    expect(swipeOutcome(MAX_PX, ARCHIVE_ONLY)).toBeNull();
  });

  it('never commits for an account that cannot write', () => {
    expect(swipeOutcome(-MAX_PX, NEITHER)).toBeNull();
    expect(swipeOutcome(MAX_PX, NEITHER)).toBeNull();
  });

  it('maps each direction to its own action and never the other', () => {
    expect(swipeOutcome(-MAX_PX, ARCHIVE_ONLY)).toBe('archive');
    expect(swipeOutcome(MAX_PX, UNREAD_ONLY)).toBe('unread');
  });
});

describe('isSwipeStarted', () => {
  it('ignores the wobble in a tap', () => {
    expect(isSwipeStarted(0)).toBe(false);
    expect(isSwipeStarted(4)).toBe(false);
    expect(isSwipeStarted(-4)).toBe(false);
  });

  it('starts at the threshold, in either direction', () => {
    expect(isSwipeStarted(START_PX)).toBe(true);
    expect(isSwipeStarted(-START_PX)).toBe(true);
  });
});

describe('the thresholds themselves', () => {
  it('lets the row travel past the commit point so the gesture can be felt', () => {
    // If MAX were below COMMIT the action could never fire, and if they
    // were equal there would be no travel confirming the commit before
    // the finger lifts.
    expect(MAX_PX).toBeGreaterThan(COMMIT_PX);
  });

  it('starts following the finger well before it can commit', () => {
    expect(START_PX).toBeLessThan(COMMIT_PX);
  });
});
