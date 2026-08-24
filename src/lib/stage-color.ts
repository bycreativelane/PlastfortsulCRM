/**
 * Stage colour → a legible chip, computed rather than curated.
 *
 * A pipeline stage carries a colour the operator picked (`pipeline_stages.color`).
 * That colour appears in two places: the 3px band on the Kanban column, and the
 * stage chip on the conversation row. The band is easy — it sits on its own. The
 * chip is not: it needs a tinted background and text that reads on it, and the
 * hue is not ours to choose.
 *
 * The naive version — `background: colour + '20'; color: colour` — is the trap.
 * For a light hue (yellow, lime, cyan, all offered by the picker) that is the
 * colour at full strength on a 12% wash of itself: about 2:1, unreadable. No
 * amount of hand-picking fixes it, because the user picks the colour.
 *
 * So: wash the hue heavily toward the surface for the background, then walk the
 * ink toward the surface's opposite until it clears 4.5:1. Any hue the operator
 * can choose comes out legible, in either mode, with nobody curating anything.
 *
 * Ported from `chipDaEtapa()` in the design prototype, with one fix — see
 * `inkFor` below.
 */

/** sRGB channel triple, 0–255. */
export type Rgb = [r: number, g: number, b: number];

/** The surface a chip sits on. Light mode is white; dark is the card. */
export const LIGHT_SURFACE: Rgb = [255, 255, 255];
export const DARK_SURFACE: Rgb = [40, 41, 46];

/** How far the hue is washed toward the surface to make the chip background. */
const WASH = 0.86;

/** WCAG AA for body text. The chip's label is small, so no 3:1 exemption. */
const MIN_CONTRAST = 4.5;

/** Steps the ink walk takes. 6% mirrors the prototype — fine enough that the
 *  result never overshoots into needlessly dark, coarse enough to converge in
 *  well under twenty iterations. */
const STEP = 0.06;

export function parseHex(hex: string): Rgb | null {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const x = relativeLuminance(a) + 0.05;
  const y = relativeLuminance(b) + 0.05;
  return Math.max(x, y) / Math.min(x, y);
}

const rgbString = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

/** Mix `from` toward `to` by `amount` (0 = unchanged, 1 = fully `to`). */
function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((c, i) => Math.round(c + (to[i] - c) * amount)) as Rgb;
}

/**
 * Walk the hue away from the background until it clears MIN_CONTRAST.
 *
 * The walk runs all the way to the extreme — black on a light background,
 * white on a dark one — which always clears the bar, because the background is
 * 86% of the way to the surface by construction. So there is no path out of
 * this function that returns something unreadable.
 *
 * The prototype's version stopped early (`while … && f > .12`) and returned
 * whatever it had. Swept over 636k colours that guard never actually fires —
 * darkening gets there first every time, worst case 4.50:1 — so this is
 * closing a latent hole, not fixing an observed bug. Worth closing anyway:
 * the bound is what makes the guarantee above unconditional, and the dark-mode
 * surface (added here, absent from the prototype) changes the arithmetic the
 * original was empirically safe under.
 */
function inkFor(hue: Rgb, background: Rgb, surface: Rgb): Rgb {
  // Away from the surface: darker on white, lighter on a dark card.
  const extreme: Rgb =
    relativeLuminance(surface) > 0.5 ? [0, 0, 0] : [255, 255, 255];

  let ink = hue;
  for (let amount = 0; amount <= 1 + 1e-9; amount += STEP) {
    ink = mix(hue, extreme, amount);
    if (contrastRatio(ink, background) >= MIN_CONTRAST) return ink;
  }
  return extreme;
}

export interface StageChip {
  /** CSS colour for the chip's background. */
  background: string;
  /** CSS colour for the chip's label. */
  ink: string;
  /** Measured contrast of ink on background — exposed so tests can assert it. */
  contrast: number;
}

/**
 * Background + label colours for a stage chip.
 *
 * Falls back to a neutral chip for a colour that isn't parseable, which is what
 * a hand-edited or legacy `pipeline_stages.color` can be. Never throws: this
 * runs inside a conversation row, and a bad hex must not take the list down.
 */
export function stageChip(
  hex: string,
  surface: Rgb = LIGHT_SURFACE
): StageChip {
  const hue = parseHex(hex) ?? parseHex('#7c828a')!;
  const background = mix(hue, surface, WASH);
  const ink = inkFor(hue, background, surface);
  return {
    background: rgbString(background),
    ink: rgbString(ink),
    contrast: contrastRatio(ink, background),
  };
}

/**
 * Resolve a stage's colour, preferring an operator override.
 *
 * `pipeline_stages.color` is the stored value; `overrides` carries per-stage
 * choices keyed `"<pipelineId>|<stageId>"`. Kept separate from `stageChip` so
 * the lookup and the colour maths stay independently testable.
 */
export function resolveStageColor(
  storedColor: string | null | undefined,
  key: string,
  overrides: Record<string, string> = {}
): string {
  return overrides[key] ?? storedColor ?? '#7c828a';
}
