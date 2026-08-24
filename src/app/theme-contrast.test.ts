import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The colour doctrine is only worth anything if the pairs it prescribes
// are actually readable, and nothing else in the build checks that. A
// token nudged half a step for aesthetic reasons — or an accent swapped
// during a rebrand — silently drops a chip under 4.5:1, and the only
// way anyone finds out is a user squinting at an amber badge.
//
// This reads the real values out of globals.css (not a copy, which
// would drift) and asserts every documented foreground/background pair
// in BOTH modes. Light is the product's default; dark is still shipped,
// so both have to hold.
//
// Thresholds are WCAG 2.1: 4.5:1 for body text, 3:1 for meaningful
// non-text graphics (1.4.11) such as the read receipt.

// Two normalisations before a single character is matched, and both
// exist because this reads a WORKING-TREE file rather than a string the
// test controls.
//
//   · quotes — attribute selectors are matched as literal strings
//     below, so the quote style has to be pinned. Prettier rewrites
//     `[data-mode="dark"]` to single quotes in CSS, and a
//     `npm run format` would otherwise turn this whole suite red
//     without a single colour having changed. Swapping quotes for
//     double preserves every character position, so the offsets used
//     to slice out a block stay valid.
//   · newlines — this repo is checked out with `core.autocrlf=true`,
//     so every file in a Windows clone has CRLF endings while the
//     committed blob has LF. The selectors below are written with bare
//     LF, which then matches on CI and fails on the maintainer's own
//     machine, with an error ("block not found") that points at the CSS
//     rather than at the line endings. Collapsing first costs nothing:
//     CR is not a character any selector here contains.
const CSS = readFileSync(
  join(process.cwd(), 'src', 'app', 'globals.css'),
  'utf8'
)
  .replace(/\r\n/g, '\n')
  .replace(/'/g, '"');

type Oklch = [l: number, c: number, h: number];

/**
 * Pull `--token: oklch(L C H)` out of one CSS block.
 *
 * Scoped to a block because the same token names are defined twice —
 * once per mode — and a whole-file scan would silently return whichever
 * came first, testing light's values against dark's label.
 */
function tokensIn(selector: string): Map<string, Oklch> {
  // The selector has to head an actual RULE, not merely appear
  // somewhere in the file. `indexOf` was enough until the day
  // `html[data-mode="dark"]` appeared inside a `@custom-variant`
  // declaration near the top of globals.css: the search landed on that
  // line, sliced from the wrong brace, and every dark-mode assertion in
  // this suite failed at once — while pointing at the colours, which
  // were fine. Anchoring on the `{` that follows the selector is what
  // makes "this selector" mean the rule and not the string.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{`).exec(CSS);
  if (!match) throw new Error(`block not found: ${selector}`);
  const open = match.index + match[0].length - 1;
  const close = CSS.indexOf('\n}', open);
  const block = CSS.slice(open, close);

  const out = new Map<string, Oklch>();
  for (const m of block.matchAll(
    /(--[\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/g
  )) {
    out.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
  }

  // Aliases — `--destructive: var(--danger-700)`.
  //
  // A token that points at another token was invisible to this test:
  // the regex above only matches a literal `oklch(...)`, so an alias
  // silently produced no entry, and a pair referencing it would have
  // failed the "defines every token" guard rather than being measured.
  // That is exactly how `--destructive` — the ink on the "Excluir" item
  // of every dropdown in the app — sat at 3.95:1 in dark mode with a
  // green suite.
  //
  // Resolved iteratively so an alias can point at an alias; the loop is
  // bounded by the number of aliases, and stops as soon as a pass
  // resolves nothing (which is also what breaks a reference cycle).
  const aliases = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+):\s*var\((--[\w-]+)\)/g)) {
    aliases.set(m[1], m[2]);
  }
  for (let pass = 0; pass < aliases.size; pass++) {
    let resolved = 0;
    for (const [alias, target] of aliases) {
      if (out.has(alias)) continue;
      const value = out.get(target);
      if (value) {
        out.set(alias, value);
        resolved++;
      }
    }
    if (resolved === 0) break;
  }

  return out;
}

/**
 * Mode tokens plus the default accent's.
 *
 * The two axes are separate blocks by design — neutrals live in the
 * mode, `--primary` lives in the theme — but a rendered page composes
 * them, so a contrast check has to as well. Only the shipped default
 * accent is asserted: the other four are upstream's and are not part of
 * this product's doctrine.
 */
function paletteFor(
  modeSelector: string,
  accentSelectors: string[]
): Map<string, Oklch> {
  const merged = new Map(tokensIn(modeSelector));
  // Later selectors win, mirroring CSS specificity: the base accent
  // block first, then any mode-specific override of it.
  for (const selector of accentSelectors) {
    for (const [k, v] of tokensIn(selector)) merged.set(k, v);
  }
  return merged;
}

/** OKLCH → linear sRGB → relative luminance (WCAG 2.1 formula). */
function luminance([L, C, H]: Oklch): number {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.089484178 * a - 1.291485548 * b) ** 3;

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));

  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(fg: Oklch, bg: Oklch): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const WHITE: Oklch = [1, 0, 0];

/** [label, foreground token, background token, minimum ratio] */
const PAIRS: Array<[string, string, string, number]> = [
  ['body text on the page', '--foreground', '--background', 4.5],
  ['body text on a card', '--foreground', '--card', 4.5],
  ['secondary text on a card', '--secondary-foreground', '--card', 4.5],
  ['muted text on a card', '--muted-foreground', '--card', 4.5],
  // The ink on "Excluir" in every dropdown, and on the destructive
  // button. It was in no pair at all until this audit, which is why it
  // could sit at 3.95:1 in dark mode without anything going red.
  ['destructive text on a card', '--destructive', '--card', 4.5],
  ['destructive text on its own tint', '--destructive', '--danger-50', 4.5],
  ['muted text on a muted surface', '--muted-foreground', '--muted', 4.5],
  ['accent link on a card', '--primary', '--card', 4.5],
  ['amber chip ink on its tint', '--human-700', '--human-50', 4.5],
  ['error chip ink on its tint', '--danger-700', '--danger-50', 4.5],
  ['confirmed chip ink on its tint', '--ok-700', '--ok-50', 4.5],
  ['automation chip ink on a muted surface', '--auto-700', '--muted', 4.5],
  ['message text in an outbound bubble', '--foreground', '--wa-out', 4.5],
  ['message text in an inbound bubble', '--foreground', '--wa-in', 4.5],
  ['timestamp in an outbound bubble', '--muted-foreground', '--wa-out', 4.5],
  ['timestamp in an inbound bubble', '--muted-foreground', '--wa-in', 4.5],
  // Icon, not text — WCAG 1.4.11. WhatsApp's own #53bdeb on its green
  // bubble is 1.92:1; ours is deliberately darker. See globals.css.
  ['read receipt on an outbound bubble', '--wa-tick', '--wa-out', 3],
  // Anything INSIDE a bubble sits on `--wa-inset`, which is translucent.
  // The parser below stops before the `/ alpha`, so measuring against it
  // directly would read the opaque ink it derives from and pass on a
  // colour nobody renders. `--wa-out-inset` is that wash pre-composited
  // over the outbound green, and exists only to be measured.
  //
  // Only `--foreground` is asserted, and that is the point: the obvious
  // secondary ink, `--muted-foreground`, measures 4.18:1 light and 3.98:1
  // dark on this ground — it FAILS — which is why the surfaces inside a
  // bubble use `--foreground` at reduced alpha instead of the muted token.
  ['attachment label on an inset in a bubble', '--foreground', '--wa-out-inset', 4.5],
];

/**
 * Text sitting ON a solid fill. These are the pairs that bit upstream —
 * a mid-weight amber under white text sits at 2.9:1.
 *
 * The primary button takes its ink from `--primary-foreground`, which
 * is part of the theme and flips to dark in dark mode. The other two
 * hard-code `text-white` at the call site, so white is what has to be
 * asserted for them, in both modes.
 */
const ON_FILL: Array<[string, string, string | null, number]> = [
  ['button ink on a primary fill', '--primary', '--primary-foreground', 4.5],
  ['white text on an amber badge', '--human-strong', null, 4.5],
  ['white text on a destructive button', '--danger-solid', null, 4.5],
  // The initials on an avatar disc. White in light mode, the card colour in
  // dark, and the disc itself moves — so both halves have to be asserted per
  // mode rather than assumed.
  ['avatar 1 ink', '--avatar-1', '--avatar-ink', 4.5],
  ['avatar 2 ink', '--avatar-2', '--avatar-ink', 4.5],
  ['avatar 3 ink', '--avatar-3', '--avatar-ink', 4.5],
  ['avatar 4 ink', '--avatar-4', '--avatar-ink', 4.5],
  ['avatar 5 ink', '--avatar-5', '--avatar-ink', 4.5],
  ['avatar 6 ink', '--avatar-6', '--avatar-ink', 4.5],
  ['avatar 7 ink', '--avatar-7', '--avatar-ink', 4.5],
  ['avatar 8 ink', '--avatar-8', '--avatar-ink', 4.5],
];

/**
 * A SURFACE against the surface behind it — WCAG 1.4.11, the same 3:1 the
 * read receipt above is held to.
 *
 * This table exists because the suite had no such pair and therefore could
 * not see the bug that produced it: every avatar in the app was filled with
 * `--muted`, which is 1.14:1 on a card and EXACTLY 1.00:1 on a selected
 * conversation row, whose fill is also `--muted`. The disc was invisible and
 * twenty green assertions had nothing to say about it, because all twenty
 * ask about ink.
 *
 * All eight discs against all four grounds they can land on, rather than a
 * spot check: they share a lightness band, so if one of them drifts the
 * whole point of the band is gone and the cheapest way to notice is to
 * measure them all.
 */
const SURFACES: Array<[string, string, string, number]> = [
  ['avatar 1 on a card', '--avatar-1', '--card', 3],
  ['avatar 1 on a selected row', '--avatar-1', '--muted', 3],
  ['avatar 1 on a hovered row', '--avatar-1', '--card-2', 3],
  ['avatar 1 on the page', '--avatar-1', '--background', 3],
  ['avatar 2 on a card', '--avatar-2', '--card', 3],
  ['avatar 2 on a selected row', '--avatar-2', '--muted', 3],
  ['avatar 2 on a hovered row', '--avatar-2', '--card-2', 3],
  ['avatar 2 on the page', '--avatar-2', '--background', 3],
  ['avatar 3 on a card', '--avatar-3', '--card', 3],
  ['avatar 3 on a selected row', '--avatar-3', '--muted', 3],
  ['avatar 3 on a hovered row', '--avatar-3', '--card-2', 3],
  ['avatar 3 on the page', '--avatar-3', '--background', 3],
  ['avatar 4 on a card', '--avatar-4', '--card', 3],
  ['avatar 4 on a selected row', '--avatar-4', '--muted', 3],
  ['avatar 4 on a hovered row', '--avatar-4', '--card-2', 3],
  ['avatar 4 on the page', '--avatar-4', '--background', 3],
  ['avatar 5 on a card', '--avatar-5', '--card', 3],
  ['avatar 5 on a selected row', '--avatar-5', '--muted', 3],
  ['avatar 5 on a hovered row', '--avatar-5', '--card-2', 3],
  ['avatar 5 on the page', '--avatar-5', '--background', 3],
  ['avatar 6 on a card', '--avatar-6', '--card', 3],
  ['avatar 6 on a selected row', '--avatar-6', '--muted', 3],
  ['avatar 6 on a hovered row', '--avatar-6', '--card-2', 3],
  ['avatar 6 on the page', '--avatar-6', '--background', 3],
  ['avatar 7 on a card', '--avatar-7', '--card', 3],
  ['avatar 7 on a selected row', '--avatar-7', '--muted', 3],
  ['avatar 7 on a hovered row', '--avatar-7', '--card-2', 3],
  ['avatar 7 on the page', '--avatar-7', '--background', 3],
  ['avatar 8 on a card', '--avatar-8', '--card', 3],
  ['avatar 8 on a selected row', '--avatar-8', '--muted', 3],
  ['avatar 8 on a hovered row', '--avatar-8', '--card-2', 3],
  ['avatar 8 on the page', '--avatar-8', '--background', 3],
];

describe.each([
  [
    'light',
    ':root,\nhtml[data-mode="light"]',
    ['html[data-theme="plastfortsul"]'],
  ],
  [
    'dark',
    'html[data-mode="dark"]',
    [
      'html[data-theme="plastfortsul"]',
      'html[data-mode="dark"][data-theme="plastfortsul"]',
    ],
  ],
])('%s mode meets WCAG AA', (mode, selector, accents) => {
  const tokens = paletteFor(selector, accents);

  it('defines every token the pairs reference', () => {
    // Guards the guard: a renamed token would otherwise make every
    // assertion below skip silently rather than fail.
    const referenced = new Set([
      ...PAIRS.flatMap(([, fg, bg]) => [fg, bg]),
      ...ON_FILL.flatMap(([, fill, ink]) => (ink ? [fill, ink] : [fill])),
      ...SURFACES.flatMap(([, fill, ground]) => [fill, ground]),
    ]);
    const missing = [...referenced].filter((t) => !tokens.has(t)).sort();
    expect(missing, `${mode} mode is missing these tokens`).toEqual([]);
  });

  it.each(PAIRS)('%s', (_label, fg, bg, min) => {
    const ratio = contrast(tokens.get(fg)!, tokens.get(bg)!);
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min);
  });

  it.each(ON_FILL)('%s', (_label, fill, ink, min) => {
    const ratio = contrast(ink ? tokens.get(ink)! : WHITE, tokens.get(fill)!);
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min);
  });

  it.each(SURFACES)('%s', (_label, fill, ground, min) => {
    const ratio = contrast(tokens.get(fill)!, tokens.get(ground)!);
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min);
  });

  /**
   * Three tints of ink, and each one visibly weaker than the last.
   *
   * Contrast on its own does not catch this: dark mode shipped with
   * `--secondary-foreground` set to the SAME value as `--foreground`,
   * so it passed every pair above at 15.9:1 while the middle step of
   * the hierarchy did not exist. Everything that reaches for it — a
   * tile's caption, a row's second line, a field's help text — came out
   * at full strength, and the page had two levels of emphasis where the
   * light mode has three.
   *
   * 1.25 is the floor for "a person can see that one is quieter".
   * Below that the two tints are the same decision written twice.
   */
  it('keeps three separated tints of ink', () => {
    const card = tokens.get('--card')!;
    const steps = ['--foreground', '--secondary-foreground', '--muted-foreground'] as const;
    const ratios = steps.map((t) => contrast(tokens.get(t)!, card));

    for (let i = 0; i < ratios.length - 1; i++) {
      expect(
        Number((ratios[i] / ratios[i + 1]).toFixed(2)),
        `${steps[i]} (${ratios[i].toFixed(2)}:1) is not clearly stronger than ${steps[i + 1]} (${ratios[i + 1].toFixed(2)}:1) in ${mode} mode`
      ).toBeGreaterThanOrEqual(1.25);
    }
  });
});
