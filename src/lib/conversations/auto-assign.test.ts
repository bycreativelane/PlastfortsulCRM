import { describe, expect, it } from 'vitest';
import { nextInRotation, type RotationMember } from './auto-assign';

const member = (userId: string, online = true): RotationMember => ({
  userId,
  online,
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
