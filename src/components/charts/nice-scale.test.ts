import { describe, expect, it } from 'vitest';

import { niceScale, peakPercent } from './chart-primitives';

/**
 * The guard for the bug that made a gridline lie.
 *
 * `conversations-chart.tsx` built its ticks as
 * `[0, ceil/4, ceil/2, 3*ceil/4, ceil].map(Math.round)`. With a ceiling
 * of 10 that PRINTS 0 · 3 · 5 · 8 · 10 and DRAWS 0 · 2.5 · 5 · 7.5 · 10,
 * because rounding a label does not move the line under it. Anybody
 * measuring a point against the line captioned "3" read 20% high.
 *
 * The class of bug is what the first test pins, and it is the one worth
 * pinning: a tick is only useful if the number on it is the number at
 * that height. Everything else here follows from that.
 */
describe('niceScale', () => {
  it('never labels a tick with a number it is not drawn at', () => {
    // Every tick has to be a whole number of steps from zero, and the
    // steps have to be equal — which is exactly the property the old
    // `Math.round` on the label destroyed.
    for (const peak of [1, 3, 7, 10, 13, 42, 99, 180, 1_284, 25_000]) {
      const { max, ticks } = niceScale(peak);

      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBe(max);
      expect(max).toBeGreaterThanOrEqual(peak);

      const step = ticks[1] - ticks[0];
      ticks.forEach((tick, i) => {
        // toBeCloseTo, not toBe: the ticks are accumulated by addition
        // and 0.1 + 0.2 is still 0.30000000000000004 in a chart axis.
        expect(tick).toBeCloseTo(i * step, 9);
      });
    }
  });

  it('reproduces the case that was wrong, correctly', () => {
    // The exact input from the screenshot: ten messages on the busiest
    // day. The old code answered 0 · 3 · 5 · 8 · 10.
    const { max, ticks } = niceScale(10, { integer: true });
    expect(max).toBe(10);
    expect(ticks).toEqual([0, 5, 10]);
  });

  it('keeps a count axis free of fractional labels', () => {
    for (const peak of [1, 2, 3, 6, 7, 9, 10, 11, 30]) {
      const { ticks } = niceScale(peak, { integer: true });
      for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true);
    }
  });

  it('allows a half step where the quantity is a measurement', () => {
    // Minutes are not a count. 2.5 is a legitimate reading of one, and
    // forbidding it costs the axis a step it could have used.
    const { ticks } = niceScale(10);
    expect(ticks).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('gives an empty series an axis rather than a division by zero', () => {
    for (const peak of [0, -1, Number.NaN]) {
      const { max, ticks } = niceScale(peak);
      expect(max).toBe(4);
      expect(ticks).toEqual([0, 1, 2, 3, 4]);
    }
  });
});

/**
 * The scaling rule the four bar implementations disagreed about.
 */
describe('peakPercent', () => {
  it('measures against the biggest row, not the total', () => {
    // The funnel from the screenshot. Against the TOTAL (113.201) Novo
    // Lead is 6% and draws a stub; against the PEAK it is 17% and is
    // legible next to its neighbours.
    const values = [7300, 9800, 18430, 0, 3120, 42751, 25100, 6700];
    expect(peakPercent(7300, values)).toBeCloseTo(17.07, 1);
    expect(peakPercent(42751, values)).toBe(100);
  });

  it('draws nothing for zero', () => {
    // The floor that used to live in the funnel (`Math.max(2, …)`)
    // painted a 2% bar for a stage worth R$ 0 — the one value a bar
    // must never show, because the reader has no way to tell it from
    // "a very little".
    expect(peakPercent(0, [7300, 0, 42751])).toBe(0);
  });

  it('survives an all-zero set', () => {
    expect(peakPercent(0, [0, 0, 0])).toBe(0);
    expect(peakPercent(0, [])).toBe(0);
  });
});
