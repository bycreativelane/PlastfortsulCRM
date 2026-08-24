import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No component may reach for a colour the theme does not own.
 *
 * `theme-contrast.test.ts` asserts that the documented token PAIRS are
 * readable. It reads `--token: oklch(…)` declarations out of
 * globals.css, which means it is structurally blind to a component that
 * writes `text-teal-300` and never passes through a token at all. This
 * is the other half of that guard, and between them they cover the two
 * ways colour goes wrong here: a token drifting, and a call site
 * escaping the tokens entirely.
 *
 * `globals.css` re-points a set of raw Tailwind shades onto the
 * doctrine tokens — `text-red-400` compiles to `var(--danger-700)`,
 * `bg-amber-500` to the human token — precisely so the ~140 upstream
 * call sites that reach for them land on values that are correct in
 * both modes. That mapping covers red, amber, yellow, emerald, green,
 * orange and blue, and it stops at 700.
 *
 * Everything else is outside the system:
 *
 *   · Unmapped families (teal, cyan, purple, rose, violet, sky, slate,
 *     …) are Tailwind's own palette, chosen for a dark-first app. This
 *     product is light by default, and they land where you would
 *     expect: the automation trigger pills measured between 1.3:1 and
 *     1.6:1 on a white card, the flow node menu was an
 *     indistinguishable pale smear, and the response-time target chip
 *     was a red-pink at 1.66:1 that read as a failure on a chart that
 *     was fine.
 *
 *   · The 800/900/950 shades of the MAPPED families fall through the
 *     mapping, so `bg-amber-950` is still Tailwind's near-black amber.
 *     That is how the WhatsApp setup banners reached 2.73:1 in light
 *     mode.
 *
 * Comments are exempt. Every raw shade left in this codebase today sits
 * inside a note explaining what was removed and why, and deleting those
 * notes to satisfy a regex would throw away the only record of the
 * reasoning.
 */
const SRC = join(process.cwd(), 'src');

const PROPERTY =
  'bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow|accent|caret';

/** Families globals.css never re-points. */
const UNMAPPED_FAMILY = new RegExp(
  `\\b(?:${PROPERTY})-(?:teal|cyan|purple|pink|rose|indigo|violet|fuchsia|sky|slate|lime|gray|zinc|neutral|stone)-\\d{2,3}\\b`,
  'g'
);

/** Mapped families, past where the mapping stops. */
const TOO_DARK_SHADE = new RegExp(
  `\\b(?:${PROPERTY})-(?:red|amber|emerald|blue|yellow|orange|green)-(?:800|900|950)\\b`,
  'g'
);

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) =>
      '\n'.repeat((block.match(/\n/g) ?? []).length)
    )
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return componentFiles(full);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

describe('colour doctrine', () => {
  it('no component reaches for a colour the theme does not own', () => {
    const offenders: string[] = [];

    for (const file of componentFiles(SRC)) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const pattern of [UNMAPPED_FAMILY, TOO_DARK_SHADE]) {
        for (const m of source.matchAll(pattern)) {
          const line = source.slice(0, m.index).split('\n').length;
          offenders.push(
            `${file.slice(SRC.length + 1).replace(/\\/g, '/')}:${line} — ${m[0]}`
          );
        }
      }
    }

    expect(
      offenders.sort(),
      'Use a doctrine token instead: human (a person must act) · auto (a machine did this) · ok (confirmed) · danger (it failed) · primary (the accent, which is not a signal). The tokens are at the top of globals.css.'
    ).toEqual([]);
  });
});
