import { describe, expect, it } from 'vitest';
import { nextInRotation, type RotationMember } from './auto-assign';

const member = (
  userId: string,
  online = true,
  openCount?: number
): RotationMember => ({
  userId,
  online,
  ...(openCount === undefined ? {} : { openCount }),
});

describe('nextInRotation', () => {
  it('starts at the top when nothing has been assigned yet', () => {
    expect(nextInRotation([member('a'), member('b')], null)).toBe('a');
  });

  it('resumes after the last recipient', () => {
    const pool = [member('a'), member('b'), member('c')];
    expect(nextInRotation(pool, 'a')).toBe('b');
    expect(nextInRotation(pool, 'b')).toBe('c');
  });

  it('wraps around the end', () => {
    expect(nextInRotation([member('a'), member('b')], 'b')).toBe('a');
  });

  it('skips members who are offline', () => {
    // The whole reason presence is in this function: an owner who went home
    // is worse than no owner, because the thread stops showing up in the
    // unassigned queue precisely because somebody "has" it.
    const pool = [member('a', false), member('b'), member('c', false)];
    expect(nextInRotation(pool, null)).toBe('b');
    expect(nextInRotation(pool, 'b')).toBe('b');
  });

  it('rotates over everyone when nobody is online', () => {
    // Out of hours the choice is an owner who sees it in the morning, or no
    // owner at all. The first is more useful, and it is what a human
    // dispatcher would do.
    const pool = [member('a', false), member('b', false)];
    expect(nextInRotation(pool, null)).toBe('a');
    expect(nextInRotation(pool, 'a')).toBe('b');
  });

  it('starts over when the last recipient has left the account', () => {
    // A cursor pointing at somebody who is gone must not stall the rotation.
    expect(nextInRotation([member('b'), member('c')], 'a')).toBe('b');
  });

  it('starts over when the last recipient went offline', () => {
    // `a` is not in the online pool any more, so the cursor does not resolve
    // — and the answer is the top of the pool rather than nothing.
    const pool = [member('a', false), member('b'), member('c')];
    expect(nextInRotation(pool, 'a')).toBe('b');
  });

  it('keeps handing work to a single member rather than stalling', () => {
    expect(nextInRotation([member('a')], 'a')).toBe('a');
  });

  it('assigns nobody when the account has no members', () => {
    expect(nextInRotation([], 'a')).toBeNull();
  });

  it('spreads a run of conversations evenly', () => {
    // The property the old implementation failed: `profiles ... limit(1)`
    // handed all five of these to the same person.
    const pool = [member('a'), member('b'), member('c')];
    const got: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      cursor = nextInRotation(pool, cursor);
      got.push(cursor!);
    }
    expect(got).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });
});

describe('nextInRotation rules (migration 051)', () => {
  it('leaves the thread in the queue when asked and nobody is online', () => {
    // The other half of the out-of-hours argument above. Both answers are
    // defensible; which is right depends on whether this team treats
    // "unassigned" as a queue somebody watches or a hole things fall into.
    const pool = [member('a', false), member('b', false)];
    expect(
      nextInRotation(pool, null, { offlineFallback: 'leave_unassigned' })
    ).toBeNull();
  });

  it('still assigns out of hours when the fallback is left alone', () => {
    const pool = [member('a', false), member('b', false)];
    expect(nextInRotation(pool, null, { offlineFallback: 'rotate_all' })).toBe(
      'a'
    );
  });

  it('skips somebody already at the ceiling', () => {
    const pool = [member('a', true, 5), member('b', true, 1)];
    expect(nextInRotation(pool, null, { maxOpen: 5 })).toBe('b');
  });

  it('ignores the ceiling rather than jamming when everybody is at it', () => {
    // The property that matters: a cap must never be able to stop the
    // queue being distributed on the one afternoon it fills up.
    const pool = [member('a', true, 9), member('b', true, 9)];
    expect(nextInRotation(pool, null, { maxOpen: 5 })).toBe('a');
    expect(nextInRotation(pool, 'a', { maxOpen: 5 })).toBe('b');
  });

  it('least_busy picks the lightest load, not the next turn', () => {
    const pool = [member('a', true, 4), member('b', true, 1), member('c', true, 7)];
    expect(nextInRotation(pool, 'a', { strategy: 'least_busy' })).toBe('b');
  });

  it('least_busy breaks ties by continuing the rotation', () => {
    // A quiet morning has everybody on zero. Without the tie-break every
    // thread would go to whoever happens to be first in the array.
    const pool = [member('a', true, 0), member('b', true, 0), member('c', true, 0)];
    let cursor: string | null = null;
    const got: string[] = [];
    for (let i = 0; i < 4; i++) {
      cursor = nextInRotation(pool, cursor, { strategy: 'least_busy' });
      got.push(cursor!);
    }
    expect(got).toEqual(['a', 'b', 'c', 'a']);
  });

  it('least_busy still respects presence', () => {
    // The lightest load is offline; the rotation is over who is here.
    const pool = [member('a', false, 0), member('b', true, 6)];
    expect(nextInRotation(pool, null, { strategy: 'least_busy' })).toBe('b');
  });

  it('is byte-identical to the old behaviour with no rules', () => {
    const pool = [member('a', true, 9), member('b', true, 0)];
    expect(nextInRotation(pool, null)).toBe('a');
    expect(nextInRotation(pool, 'a')).toBe('b');
  });
});
