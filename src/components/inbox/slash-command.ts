import type { QuickReply } from '@/types';

/**
 * `/` in the message field opens the quick replies, INLINE.
 *
 * The sibling of `@` in `assign-mention.ts`, and deliberately the same shape:
 * a panel above the field, arrow keys, Enter, Escape, and the textarea never
 * loses focus. It replaced a modal — the picker was reachable only from the ⋯
 * menu, and putting a dialog in front of somebody mid-sentence is worse than
 * the two clicks it saved. A shortcut that interrupts is not a shortcut.
 *
 * It only opens at the START of the field, and that rule matters more here
 * than it does for `@`. A stray `@` mid-message is rare; a stray `/` is
 * everywhere — "R$ 12/kg", "seg/qua/sex", every URL anybody pastes. A panel
 * that sprang open over those is a panel people learn to fight.
 */

/**
 * Is the field in `/` mode, and what has been typed after it?
 *
 * Null closes the panel. A space ends it: `/ola ` is somebody who started
 * typing a message, not somebody still choosing.
 */
export function slashQuery(text: string): string | null {
  if (!text.startsWith('/')) return null;
  const rest = text.slice(1);
  if (/\s/.test(rest)) return null;
  return rest;
}

/**
 * How a snippet matched — the panel shows nothing about it, the ORDER does.
 * 0 sorts first.
 */
function rank(item: QuickReply, q: string): number {
  const shortcut = (item.shortcut ?? '').toLowerCase();
  if (shortcut && shortcut === q) return 0;
  if (shortcut && shortcut.startsWith(q)) return 1;
  const words = [item.title, item.content_text ?? '']
    .join(' ')
    .toLowerCase()
    .split(/\s+/);
  return words.some((word) => word.startsWith(q)) ? 2 : -1;
}

/**
 * Quick replies matching what has been typed.
 *
 * WORD PREFIX, never a loose substring — the rule `assign-mention.ts` states
 * with this exact example: `/pra` bringing back "Compra Futura" is the kind of
 * result that makes somebody stop trusting the list. Prefix matching over each
 * word of the title means `pra` finds "Prazo de entrega" and not "Compra".
 *
 * The body is searched too, on the same rule: an operator remembers what a
 * snippet SAYS more often than what they called it.
 *
 * SHORTCUTS COME FIRST, exact before prefix. Somebody typing `/frete` has
 * already decided; the panel is confirming, not offering. If a title match
 * could outrank the shortcut that was typed letter for letter, Enter would
 * send the wrong snippet — and Enter is how this is used.
 *
 * Ordering is stable within a rank, so the account's own order (shortcuts
 * alphabetical, then newest) survives underneath.
 */
export function filterQuickReplies(
  items: QuickReply[],
  query: string
): QuickReply[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items
    .map((item, index) => ({ item, index, rank: rank(item, q) }))
    .filter((row) => row.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.item);
}
