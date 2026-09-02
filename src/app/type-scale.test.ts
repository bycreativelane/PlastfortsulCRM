import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The type scale is eight steps, and this test is what keeps it there.
 *
 * The app reached twenty distinct font sizes without anybody deciding
 * to have twenty: fourteen of them were `text-[Npx]` values typed one
 * component at a time, half of them a half-pixel apart. The scale is
 * documented in `globals.css`; the trouble with a scale that lives
 * only in a comment is that the next `text-[13px]` compiles fine,
 * renders fine, reviews fine, and the twenty comes back one call site
 * at a time.
 *
 * An arbitrary size also silently drops its line-height — `text-[11px]`
 * sets `font-size` and nothing else — so two captions of the same size
 * in two panels sit on different baselines depending on what their
 * ancestors happened to declare. That is the failure this guards
 * against as much as the size itself.
 *
 * If a genuinely new step is needed, add it to the `@theme` block in
 * `globals.css` as a named token WITH its line-height, and use the
 * name. The point is not that eight is a magic number; it is that the
 * list is somewhere you can read it.
 */
const SRC = join(process.cwd(), 'src');

/** `text-[13px]`, `text-[0.8rem]`, `text-[1.125em]` — any arbitrary size. */
const ARBITRARY_TEXT_SIZE = /text-\[[\d.]+(?:px|rem|em|pt)\]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    // This file names the forbidden forms in order to look for them.
    if (entry === 'type-scale.test.ts') return [];
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('type scale', () => {
  it('no component reaches for an arbitrary font size', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(ARBITRARY_TEXT_SIZE)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(
          `${file.slice(SRC.length + 1).replace(/\\/g, '/')}:${line} — ${match[0]}`
        );
      }
    }

    expect(
      offenders,
      'Use a named step from the scale in globals.css: text-3xs (10) · text-2xs (11) · text-xs (12) · text-sm (14) · text-base (16) · text-lg (18) · text-xl (20) · text-2xl (24) · text-display (32)'
    ).toEqual([]);
  });

  it('every added step declares a line-height', () => {
    const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
    for (const step of ['--text-3xs', '--text-2xs', '--text-display']) {
      expect(css, `${step} is missing from globals.css`).toContain(`${step}:`);
      expect(
        css,
        `${step} has no paired line-height — an arbitrary size with no leading is the bug this scale exists to fix`
      ).toContain(`${step}--line-height:`);
    }
  });
});
