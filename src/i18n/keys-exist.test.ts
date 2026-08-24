import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every key a component asks for has to exist in the catalogue.
 *
 * `messages.test.ts` guards the catalogues against EACH OTHER — if a key
 * is in en.json it must be in pt-BR.json and ko.json. That is a real
 * guard and it catches a real mistake, but it is blind to the opposite
 * one: a component calling `t('unmappedWarning')` for a key that is in
 * none of the three. Both files stay in perfect parity while the screen
 * renders the literal string `Broadcasts.new.unmappedWarning`.
 *
 * That is not hypothetical. Twenty keys reached this state at once —
 * the whole audience-summary block of the broadcast wizard, the media
 * errors in its header, the send confirmation dialog — because the
 * component and the catalogue are edited in different files and nothing
 * connected them. next-intl reports MISSING_MESSAGE to `onError` and
 * then renders the keypath, so nothing throws, no build fails, and dev
 * looks exactly like prod. It ships.
 *
 * What is checked: any call on a translator bound by
 * `useTranslations('Namespace')` or `getTranslations('Namespace')`,
 * where the key is a string literal.
 *
 * What is NOT checked, and cannot be: `t(dynamicKey)`, template
 * literals, and keys assembled at runtime. Those are genuinely dynamic
 * and a static reader has nothing to resolve. They are rare here and
 * every one of them is a lookup into a table the component owns.
 */
const SRC = join(process.cwd(), 'src');
const CATALOGUE = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en.json'), 'utf8')
);

function leafKeys(node: unknown, trail: string, out: Set<string>): void {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) {
      leafKeys(v, trail ? `${trail}.${k}` : k, out);
    }
    return;
  }
  out.add(trail);
}

const KEYS = new Set<string>();
leafKeys(CATALOGUE, '', KEYS);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry)) return [];
    // The i18n tests read the catalogue as data; their string literals
    // are not translator calls.
    if (/\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

/**
 * Comments out, before anything is matched.
 *
 * This repo documents heavily, and a doc block that says "the label is
 * resolved through `t('status…')` at the render site" is prose about a
 * call, not a call. Without this the first run of this test reported a
 * key named `status…`.
 *
 * Block comments go wholesale; line comments only when the `//` opens
 * the line, so a URL inside a string survives.
 *
 * A removed block is replaced by its own newlines rather than by
 * nothing, so the line numbers in a failure still point at the real
 * file. A test that reports the wrong line is worse than one that
 * reports none.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) =>
      '\n'.repeat((block.match(/\n/g) ?? []).length)
    )
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** `const t = useTranslations('Foo.bar')` → Map { t → 'Foo.bar' } */
function translatorsIn(source: string): Map<string, string> {
  const bound = new Map<string, string>();
  const binding =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']*)'\s*\)/g;
  for (const m of source.matchAll(binding)) bound.set(m[1], m[2]);
  return bound;
}

describe('translation keys', () => {
  it('every key a component asks for exists in the catalogue', () => {
    const missing: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      const bound = translatorsIn(source);
      if (bound.size === 0) continue;

      const names = [...bound.keys()].join('|');
      // `t('x')`, `t.rich('x')`, `t.raw('x')`. Not `t.has('x')` — that
      // one exists precisely to ask whether a key is there.
      const calls = new RegExp(
        `\\b(${names})(?:\\.(rich|raw))?\\(\\s*'([^']+)'`,
        'g'
      );

      for (const m of source.matchAll(calls)) {
        const namespace = bound.get(m[1])!;
        const keypath = namespace ? `${namespace}.${m[3]}` : m[3];
        if (KEYS.has(keypath)) continue;
        const line = source.slice(0, m.index).split('\n').length;
        missing.push(
          `${file.slice(SRC.length + 1).replace(/\\/g, '/')}:${line} — ${keypath}`
        );
      }
    }

    expect(
      [...new Set(missing)].sort(),
      'These keypaths are called in code and absent from messages/en.json. next-intl renders the keypath itself, so the screen shows the raw string instead of failing.'
    ).toEqual([]);
  });
});
