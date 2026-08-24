import { describe, expect, it } from 'vitest';
import {
  DARK_SURFACE,
  LIGHT_SURFACE,
  contrastRatio,
  parseHex,
  resolveStageColor,
  stageChip,
} from './stage-color';

/**
 * The ten colours the stage picker offers. A chip has to be readable for every
 * one of them — including the pale ones, which is the whole reason the ink is
 * computed instead of stored.
 */
const PALETTE = [
  '#3a6dd0',
  '#2e9c5a',
  '#e08c07',
  '#cf4a4e',
  '#7a5af0',
  '#0d8b80',
  '#c2427c',
  '#7c828a',
  '#5f8c22',
  '#cf7020',
];

/** Hues that break the naive `colour on 12% of itself` approach hardest. */
const PALE = ['#ffe500', '#00ffd5', '#c6ff00', '#ffffff', '#fff9c4'];

describe('parseHex', () => {
  it('reads six-digit hex with and without the hash', () => {
    expect(parseHex('#3a6dd0')).toEqual([58, 109, 208]);
    expect(parseHex('3a6dd0')).toEqual([58, 109, 208]);
  });

  it('expands the three-digit form', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#08f')).toEqual([0, 136, 255]);
  });

  it('returns null for anything else', () => {
    for (const bad of ['', '#', 'nope', '#12345', '#1234567', 'rgb(1,2,3)']) {
      expect(parseHex(bad), bad).toBeNull();
    }
  });
});

describe('stageChip', () => {
  it.each(PALETTE)('%s is readable on a light surface', (hex) => {
    expect(stageChip(hex, LIGHT_SURFACE).contrast).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PALETTE)('%s is readable on a dark surface', (hex) => {
    expect(stageChip(hex, DARK_SURFACE).contrast).toBeGreaterThanOrEqual(4.5);
  });

  // The prototype's loop gave up at 12% and returned whatever it had, so a hue
  // that had not converged shipped a failing pair silently. These are the hues
  // that hit that path.
  it.each(PALE)('%s converges instead of giving up', (hex) => {
    expect(stageChip(hex, LIGHT_SURFACE).contrast).toBeGreaterThanOrEqual(4.5);
    expect(stageChip(hex, DARK_SURFACE).contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('clears the bar for every hue in the sRGB cube', () => {
    // Exhaustive enough to catch a regression anywhere in the space, not just
    // on the colours someone thought to list above.
    let worst = Infinity;
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          for (const surface of [LIGHT_SURFACE, DARK_SURFACE]) {
            worst = Math.min(worst, stageChip(hex, surface).contrast);
          }
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the hue recognisable rather than jumping straight to black', () => {
    // The point of walking in steps is that a mid-weight colour keeps its
    // identity. A blue stage should read blue, not as generic dark grey.
    const { ink } = stageChip('#3a6dd0', LIGHT_SURFACE);
    const [r, g, b] = ink.match(/\d+/g)!.map(Number);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('washes the background toward the surface, not away from it', () => {
    const light = stageChip('#3a6dd0', LIGHT_SURFACE);
    const dark = stageChip('#3a6dd0', DARK_SURFACE);
    const lum = (css: string) => {
      const [r, g, b] = css.match(/\d+/g)!.map(Number);
      return contrastRatio([r, g, b], [0, 0, 0]);
    };
    expect(lum(light.background)).toBeGreaterThan(lum(dark.background));
  });

  it('falls back to neutral for an unparseable colour instead of throwing', () => {
    // `pipeline_stages.color` is a plain TEXT column with no CHECK, so a
    // legacy or hand-edited row can hold anything at all.
    for (const bad of ['', 'not-a-colour', '#12345']) {
      const chip = stageChip(bad, LIGHT_SURFACE);
      expect(chip.contrast).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('resolveStageColor', () => {
  it('prefers an operator override over the stored colour', () => {
    expect(
      resolveStageColor('#3a6dd0', 'vendas|negociacao', {
        'vendas|negociacao': '#cf4a4e',
      })
    ).toBe('#cf4a4e');
  });

  it('uses the stored colour when there is no override', () => {
    expect(resolveStageColor('#3a6dd0', 'vendas|negociacao', {})).toBe(
      '#3a6dd0'
    );
  });

  it('falls back to neutral grey when the stage carries no colour', () => {
    expect(resolveStageColor(null, 'vendas|negociacao')).toBe('#7c828a');
  });
});
