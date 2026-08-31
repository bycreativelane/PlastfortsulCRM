import { describe, it, expect } from 'vitest';

import {
  MAX_PAGES,
  PAGE_SIZE,
  TooManyRowsError,
  fetchAllPages,
} from './paged';

/**
 * The pager exists to remove a silent wrong answer, so its own failure
 * modes all have to be loud ones.
 */

/** A fake table of `total` rows, served in pages. Records what was asked. */
function fakeTable(total: number) {
  const ranges: [number, number][] = [];
  const build = (from: number, to: number) => {
    ranges.push([from, to]);
    const rows = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ i });
    return Promise.resolve({ data: rows, error: null });
  };
  return { build, ranges };
}

describe('fetchAllPages', () => {
  it('returns everything when it fits in one page', async () => {
    const { build, ranges } = fakeTable(10);
    const rows = await fetchAllPages<{ i: number }>(build);
    expect(rows).toHaveLength(10);
    // One request. A short page is the end signal, so there is no second.
    expect(ranges).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it('walks past the page cap and keeps the order', async () => {
    const { build, ranges } = fakeTable(PAGE_SIZE * 2 + 7);
    const rows = await fetchAllPages<{ i: number }>(build);
    expect(rows).toHaveLength(PAGE_SIZE * 2 + 7);
    expect(rows[0].i).toBe(0);
    expect(rows[rows.length - 1].i).toBe(PAGE_SIZE * 2 + 6);
    expect(ranges).toHaveLength(3);
  });

  /**
   * An exact multiple has no short page to stop on, so it costs one extra
   * empty request. Asserted rather than assumed — the alternative reading
   * of "a full page means keep going" is an infinite loop.
   */
  it('stops on the empty page after an exact multiple', async () => {
    const { build, ranges } = fakeTable(PAGE_SIZE);
    const rows = await fetchAllPages<{ i: number }>(build);
    expect(rows).toHaveLength(PAGE_SIZE);
    expect(ranges).toHaveLength(2);
  });

  it('an empty table is an empty array, not an error', async () => {
    const { build } = fakeTable(0);
    await expect(fetchAllPages(build)).resolves.toEqual([]);
  });

  it('a query error propagates rather than returning a short answer', async () => {
    const build = () =>
      Promise.resolve({ data: null, error: { message: 'boom' } });
    await expect(fetchAllPages(build)).rejects.toBeTruthy();
  });

  /**
   * THE ONE THIS FILE IS REALLY FOR.
   *
   * The whole point of paging is that a truncated read must not look like
   * a complete one. A ceiling that returned what it had would put the
   * original bug back, just further away — so it throws, and the caller
   * turns that into a sentence.
   */
  it('throws at the ceiling instead of returning a short answer', async () => {
    const { build } = fakeTable(PAGE_SIZE * (MAX_PAGES + 5));
    await expect(fetchAllPages(build)).rejects.toBeInstanceOf(TooManyRowsError);
  });

  it('the ceiling error says how much it read', async () => {
    const { build } = fakeTable(PAGE_SIZE * (MAX_PAGES + 5));
    await fetchAllPages(build).then(
      () => expect.unreachable('should have thrown'),
      (err: unknown) => {
        expect(err).toBeInstanceOf(TooManyRowsError);
        expect((err as TooManyRowsError).rowsRead).toBe(PAGE_SIZE * MAX_PAGES);
      }
    );
  });
});
