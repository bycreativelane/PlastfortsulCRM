/**
 * Single source of truth for the color-theme catalog.
 *
 * The CSS variables themselves live in `src/app/globals.css` under
 * `html[data-theme="..."]` blocks — that file is the one we paste
 * theme tokens into. This module only carries the metadata the UI
 * (settings picker, no-flash boot script) needs.
 *
 * Adding a new theme is a two-step change:
 *   1. Append the new `html[data-theme="<id>"]` block in globals.css
 *      with every token from an existing theme (use violet as the
 *      shape reference).
 *   2. Add an entry below. The order here drives the picker grid.
 */

export const THEME_IDS = [
  'plastfortsul',
  'violet',
  'emerald',
  'cobalt',
  'amber',
  'rose',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = 'plastfortsul';

export const STORAGE_KEY = 'wacrm.theme';

/**
 * MODE — the light/dark dimension, orthogonal to the accent theme.
 *
 * The CSS variables live in `src/app/globals.css` under
 * `html[data-mode="..."]` blocks (neutral surfaces only). Applied
 * at runtime via `document.documentElement.dataset.mode`.
 *
 * PlastfortSul inverts upstream's default: LIGHT is the product's
 * identity. The colour doctrine only works on a near-white frame —
 * amber has to be the one thing that pulls the eye, and on a dark
 * surface every accent glows equally. Dark stays available.
 *
 * Persisted under its own localStorage key so it composes freely
 * with the accent choice (you can run Violet-light or Violet-dark).
 */
export const MODES = ['light', 'dark'] as const;

export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = 'light';

export const MODE_STORAGE_KEY = 'wacrm.mode';

/**
 * The colour the BROWSER paints its own chrome with, per mode.
 *
 * These two used to sit inline in `layout.tsx` behind
 * `prefers-color-scheme` media queries — that is, keyed to the
 * OPERATING SYSTEM's preference. But this app's mode is not the
 * system's: it is `data-mode`, read from localStorage, defaulting to
 * light, with no "follow the system" option at all. So the common case
 * — a phone set to dark, the app in its default light — painted the
 * status bar `#0f1115` above a white interface. In a browser tab that
 * is a mismatched strip. Installed to the home screen, with no address
 * bar between them, it is the app's own top edge in the wrong colour.
 *
 * They live here, next to `MODES`, because two places need them and
 * one of them is the no-flash boot script — which cannot import, so it
 * interpolates this object as JSON. Same contract as `THEME_IDS`.
 *
 * The values match `--background` for each mode in `globals.css`. If
 * that token moves, move these.
 */
export const MODE_THEME_COLOR: Record<Mode, string> = {
  light: '#f5f6f7',
  dark: '#0f1115',
};

/**
 * NAV — sidebar collapsed / expanded.
 *
 * Not a theme, but it lives here for the same reason the other two do:
 * the no-flash boot script in `layout.tsx` has to read it, and that
 * script must stay import-free, so every key it touches is declared in
 * one module it can interpolate from.
 *
 * The `wacrm.` prefix is kept deliberately. Renaming the namespace
 * would silently reset every user's saved theme and mode on the next
 * deploy, which is a worse trade than a stale-looking string.
 */
export const NAV_STORAGE_KEY = 'wacrm.nav';

export type NavState = 'expanded' | 'collapsed';

export const DEFAULT_NAV: NavState = 'expanded';

export function isMode(value: unknown): value is Mode {
  return (
    typeof value === 'string' &&
    (MODES as ReadonlyArray<string>).includes(value)
  );
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  /**
   * NO TAGLINE HERE, deliberately. The sentence under each swatch lives
   * at `Settings.appearance.themes.<id>.tagline`.
   *
   * It used to be six hardcoded strings, five of them in English next to
   * one in Portuguese, on the settings page of a pt-BR install. A tagline
   * is copy; copy belongs in the message catalogue with everything else
   * that gets read.
   */
  /**
   * Static swatch color for the picker chip. Hard-coded so the boot
   * script / picker cards don't need a getComputedStyle round trip
   * before the page settles. Must mirror `--primary` of the same
   * theme in globals.css.
   */
  swatch: string;
}

export const THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: 'plastfortsul',
    name: 'PlastfortSul',
    swatch: 'oklch(0.523 0.169 262)',
  },
  {
    id: 'violet',
    name: 'Violet',
    swatch: 'oklch(0.526 0.247 293)',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    swatch: 'oklch(0.62 0.16 162)',
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    swatch: 'oklch(0.585 0.2 254)',
  },
  {
    id: 'amber',
    name: 'Amber',
    swatch: 'oklch(0.745 0.16 65)',
  },
  {
    id: 'rose',
    name: 'Rose',
    swatch: 'oklch(0.645 0.22 16)',
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === 'string' &&
    (THEME_IDS as ReadonlyArray<string>).includes(value)
  );
}
