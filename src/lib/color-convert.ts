import { parseHex, type Rgb } from '@/lib/stage-color';

/**
 * The conversions a colour picker needs, and nothing else.
 *
 * A picker is a saturation/brightness square and a hue rail, which is HSV.
 * What the product stores is a hex string, which is RGB. Neither the square
 * nor the rail can be driven from RGB without this pair, because dragging in
 * an RGB cube is not a thing anybody can aim.
 *
 * SEPARATE FROM `stage-color.ts` on purpose: that file answers "will this be
 * readable", which is contrast maths against a surface. This one answers
 * "where does the handle go", which is geometry. They share `Rgb` and
 * nothing else.
 *
 * HUE SURVIVES A GREY. `rgbToHsv` on a fully desaturated colour has no hue to
 * report — every hue produces the same grey — so it returns 0, and a picker
 * that stored that would snap the rail to red the moment somebody dragged the
 * square into the white corner. The caller keeps its own hue; see the note in
 * `color-picker.tsx`.
 */

export interface Hsv {
  /** 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  v: number;
}

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;

  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return rgb.map((n) => Math.round((n + m) * 255)) as Rgb;
}

/** `#rrggbb`, lowercase. What the database and `<input>` both want. */
export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

/** Clamp to 0–1, for a drag that left the element. */
export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
