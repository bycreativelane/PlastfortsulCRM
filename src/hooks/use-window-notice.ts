'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * "Já entendi, me deixa ver a conversa."
 *
 * The 24-hour notice is worth saying once. It was a full-width strip pinned
 * above the composer, which meant it kept saying it — a band of chrome
 * standing on the thread for as long as the window stayed closed, which for
 * a dead conversation is forever.
 *
 * So it becomes dismissible. Dismissal is safe because it is not the only
 * place the state is legible: the header pill still reads *Expirada* in
 * `danger`, the field is disabled with `sessionExpiredPlaceholder`, and the
 * send button never enables. What goes away is the repetition, not the fact.
 *
 * WHAT IS STORED IS THE WINDOW, NOT A BOOLEAN. The key is the timestamp of
 * the customer's last inbound message — the thing that defines *which*
 * window this is. So when the customer answers, that timestamp moves, the
 * stored value stops matching, and the notice comes back the next time this
 * new window closes. No expiry logic, no cleanup pass, no way to
 * accidentally silence tomorrow's notice by dismissing today's.
 *
 * Per conversation, in `localStorage`, for the same reason `use-signature`
 * is: it is how one person likes to work at one desk, not data about the
 * account. And per conversation specifically — dismissing one thread's
 * notice must not dismiss every other thread's.
 */

const keyFor = (conversationId: string) => `wacrm.windowNotice.${conversationId}`;

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Safari in private mode throws on access, not on write.
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* A preference that cannot be stored is not worth an error. */
  }
}

/**
 * Which window we are in, as a string.
 *
 * The ISO timestamp of the last inbound message, or `'none'` for a thread
 * the customer has never written to — a real state (a contact created by
 * hand, an outbound-only thread) and one that must be dismissible too,
 * without colliding with a real timestamp.
 *
 * Exported and pure so the one non-obvious thing about this design — that a
 * reply brings the notice back — can be tested without a DOM.
 */
export function windowKeyFor(lastInboundAt: string | null | undefined): string {
  return lastInboundAt ?? 'none';
}

export function useWindowNotice(
  conversationId: string | null,
  windowKey: string
) {
  const [dismissed, setDismissed] = useState(false);

  // Read on mount and on every thread or window change. A `useState`
  // initialiser cannot touch `localStorage` without breaking hydration, so
  // the first paint shows the notice and this corrects it — which is the
  // right way round: a notice that flashes is better than one that hides.
  useEffect(() => {
    if (!conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(false);
      return;
    }
    const stored = read(keyFor(conversationId));
    setDismissed(stored !== null && stored === windowKey);
  }, [conversationId, windowKey]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (conversationId) write(keyFor(conversationId), windowKey);
  }, [conversationId, windowKey]);

  return { dismissed, dismiss };
}
