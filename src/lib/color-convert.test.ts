import { describe, expect, it } from 'vitest';

import {
  clamp01,
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  rgbToHex,
  rgbToHsv,
} from './color-convert';

/**
 * The geometry behind the colour picker.
 *
 * A square and a rail are HSV; what gets stored is a hex. If the round trip
 * is not exact the handle drifts a little on every render, which reads as a
 * control fighting the person using it.
 */

describe('rgbToHsv', () => {
  it('reads the primaries', () => {
    expect(rgbToHsv([255, 0, 0])).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv([0, 255, 0])).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv([0, 0, 255])).toEqual({ h: 240, s: 1, v: 1 });
  });

  it('reports no hue and no saturation for a grey', () => {
    // Which is why the picker keeps its own hue rather than recomputing it
    // from the stored colour — see the note in `color-picker.tsx`.
    expect(rgbToHsv([128, 128, 128])).toEqual({ h: 0, s: 0, v: 128 / 255 });
    expect(rgbToHsv([0, 0, 0])).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv([255, 255, 255])).toEqual({ h: 0, s: 0, v: 1 });
  });
});

describe('hsvToRgb', () => {
  it('covers every sixth of the wheel', () => {
    expect(hsvToRgb({ h: 0, s: 1, v: 1 })).toEqual([255, 0, 0]);
    expect(hsvToRgb({ h: 60, s: 1, v: 1 })).toEqual([255, 255, 0]);
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toEqual([0, 255, 0]);
    expect(hsvToRgb({ h: 180, s: 1, v: 1 })).toEqual([0, 255, 255]);
    expect(hsvToRgb({ h: 240, s: 1, v: 1 })).toEqual([0, 0, 255]);
    expect(hsvToRgb({ h: 300, s: 1, v: 1 })).toEqual([255, 0, 255]);
  });

  it('wraps a hue past the wheel instead of clipping it', () => {
    // The rail's arrow keys walk past 360 and below 0.
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual([255, 0, 0]);
    expect(hsvToRgb({ h: -60, s: 1, v: 1 })).toEqual([255, 0, 255]);
  });
});

describe('round trip', () => {
  it('returns every preset unchanged', () => {
    // The presets are what most people click, so a drift here would be a
    // swatch that stops reading as selected the instant it is picked.
    for (const hex of [
      '#ef4444',
      '#f59e0b',
      '#22c55e',
      '#06b6d4',
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
      '#64748b',
    ]) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
    }
  });

  it('is null for something that is not a colour', () => {
    expect(hexToHsv('nope')).toBeNull();
    expect(hexToHsv('')).toBeNull();
  });

  it('accepts the three-digit shorthand', () => {
    expect(hsvToHex(hexToHsv('#0f0')!)).toBe('#00ff00');
  });
});

describe('rgbToHex', () => {
  it('pads a single digit', () => {
    expect(rgbToHex([0, 15, 255])).toBe('#000fff');
  });

  it('clamps rather than wrapping', () => {
    expect(rgbToHex([-10, 300, 128])).toBe('#00ff80');
  });
});

describe('clamp01', () => {
  it('holds a drag that left the element at the edge', () => {
    expect(clamp01(-0.4)).toBe(0);
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });
});
