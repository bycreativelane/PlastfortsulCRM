import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Locale dictionaries are hand-maintained. English is the source of
// truth (src/i18n/request.ts falls back to en.json only when a whole
// locale file is missing — there is no per-key fallback), so a key
// that lands in en.json and not in a translation renders as a raw
// keypath for users on that locale. This guards the parity.

const MESSAGES_DIR = join(process.cwd(), 'messages');
const SOURCE_LOCALE = 'en';
const TRANSLATED_LOCALES = ['pt-BR', 'ko'];

function loadKeys(locale: string): Set<string> {
  const raw = readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8');
  const out = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, path ? `${path}.${k}` : k);
      }
      return;
    }
    out.add(path);
  };
  walk(JSON.parse(raw), '');
  return out;
}

describe('message catalogue parity', () => {
  const source = loadKeys(SOURCE_LOCALE);

  it.each(TRANSLATED_LOCALES)('%s.json covers every en.json key', (locale) => {
    const translated = loadKeys(locale);
    const missing = [...source].filter((k) => !translated.has(k)).sort();
    expect(missing, `${locale}.json is missing these keys`).toEqual([]);
  });

  it.each(TRANSLATED_LOCALES)('%s.json has no orphaned keys', (locale) => {
    const translated = loadKeys(locale);
    const orphaned = [...translated].filter((k) => !source.has(k)).sort();
    expect(orphaned, `${locale}.json has keys absent from en.json`).toEqual([]);
  });

  /**
   * No key may contain a dot, and parity cannot see this.
   *
   * In next-intl the dot IS the nesting operator, so a literal
   * `"Pipelines.page": { … }` at the top level is rejected outright with
   * INVALID_KEY and the WHOLE catalogue is reported invalid on every render.
   * Two of these were written by hand and produced 1209 errors in one dev
   * server session — while `filters`, `filtersTitle` and `ownerLabel` sat in
   * the file at an address nothing could reach.
   *
   * The two tests above were blind to it by construction: the mistake was
   * made identically in all three locales, so the files agreed with each
   * other perfectly while all three were unusable.
   */
  it.each([SOURCE_LOCALE, ...TRANSLATED_LOCALES])(
    '%s.json nests with objects, never with a dot in a key',
    (locale) => {
      const raw = readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8');
      const dotted: string[] = [];
      const walk = (node: unknown, path: string): void => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        for (const [k, v] of Object.entries(node)) {
          if (k.includes('.')) dotted.push(path ? `${path}.${k}` : k);
          walk(v, path ? `${path}.${k}` : k);
        }
      };
      walk(JSON.parse(raw), '');
      expect(
        dotted.sort(),
        `${locale}.json has namespace keys containing "." — next-intl rejects the whole file`
      ).toEqual([]);
    }
  );
});
