import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No `window.confirm`, `window.prompt` or `window.alert` in the product.
 *
 * Eight of them accumulated before anybody reported one, and the reason
 * is that they WORK — nothing fails, no test goes red, and a developer
 * clicking through their own feature sees a dialog and moves on. What
 * they cost only shows up in front of a user:
 *
 *   · it says "localhost:3000 diz" in the middle of a product that draws
 *     every other dialog itself;
 *   · it blocks the main thread, so the realtime subscription, the
 *     presence heartbeat and the unread poller all stop while it is up;
 *   · it can be SUPPRESSED — browsers offer "prevent this page from
 *     creating more dialogs", and several in-app webviews refuse them
 *     outright. `confirm()` then returns false with no dialog at all,
 *     and the delete silently does nothing, forever.
 *
 * That last one is why this is a test and not a code review note: the
 * failure is invisible from the inside.
 *
 * Use `useConfirm()` from `@/components/ui/confirm-dialog` instead.
 */

const ROOT = join(process.cwd(), 'src');

// `alert(` on its own is too broad — it matches `alertVariants`, and the
// Alert component. Only the `window.`-qualified form and the bare
// `confirm(` / `prompt(` calls are worth matching, and the bare ones are
// filtered below by what precedes them.
const PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'window.confirm', re: /\bwindow\.confirm\s*\(/ },
  { label: 'window.prompt', re: /\bwindow\.prompt\s*\(/ },
  { label: 'window.alert', re: /\bwindow\.alert\s*\(/ },
  // A bare `confirm(...)` resolves to the global one too — that is
  // exactly how `whatsapp-config.tsx` slipped past a review. Anything
  // preceded by a dot, a word character or `function` is somebody's own
  // helper and not the global.
  { label: 'bare confirm()', re: /(?<![.\w])confirm\s*\(\s*['"`]/ },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('no native browser dialogs', () => {
  it('nothing in src calls window.confirm / prompt / alert', () => {
    const offenders: string[] = [];

    for (const file of walk(ROOT)) {
      // The replacement itself names them, in the comment explaining why
      // they are gone.
      if (file.endsWith(join('ui', 'confirm-dialog.tsx'))) continue;

      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // Comments are allowed to mention them — several do, on purpose.
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        for (const { label, re } of PATTERNS) {
          if (re.test(code)) {
            offenders.push(
              `${file.replace(process.cwd(), '.')}:${i + 1} — ${label}`
            );
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
