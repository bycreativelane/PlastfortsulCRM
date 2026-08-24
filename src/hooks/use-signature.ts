'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * "Quem escreveu isso?"
 *
 * The inbox is one WhatsApp number shared by the whole team, so from the
 * customer's side every reply comes from the same sender. A signature is the
 * only thing that answers the question, and it has to be part of the MESSAGE
 * — not a label the interface draws — because the customer never sees this
 * interface.
 *
 * Two settings that are deliberately not one:
 *
 *   · THE NAME is per agent and outlives conversations. "Thales" by default,
 *     because that is who they are, but editable — an operator who signs
 *     "Thales · Vendas" or just "T" is answering the same question their own
 *     way.
 *
 *   · THE SWITCH is per CONVERSATION. Signing every message of a thread you
 *     have been holding for an hour turns the signature into noise; the
 *     question it answers is only asked when the voice changes. So it starts
 *     from the agent's default and each thread remembers its own answer.
 *
 * Both live in `localStorage` on purpose. Neither is data about the customer
 * or the account — it is how one person likes to work at one desk — and
 * putting it in Postgres would mean a migration, an RLS policy and a
 * round-trip for a preference that has to be readable before the first
 * paint. The prototype makes the same call, with the same keys.
 */

const NAME_KEY = 'wacrm.signature.name';
const DEFAULT_ON_KEY = 'wacrm.signature.default';
const perConversationKey = (conversationId: string) =>
  `wacrm.signature.${conversationId}`;

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
 * Prefix a message with the signature, WhatsApp-style.
 *
 * `*Thales*` renders bold on the customer's phone and as a plain asterisked
 * word anywhere that does not parse it — which is the right failure. The
 * newline keeps it a line of its own rather than the first word of the
 * sentence.
 *
 * Exported and pure so the one place that matters — what is actually sent —
 * can be tested without a DOM.
 */
export function signMessage(text: string, name: string): string {
  const signature = name.trim();
  if (!signature) return text;
  return `*${signature}*\n${text}`;
}

export function useSignature(conversationId: string | null, agentName: string) {
  const [name, setNameState] = useState('');
  const [enabled, setEnabledState] = useState(false);

  // Read on mount and whenever the thread changes. `useState` initialisers
  // cannot touch `localStorage` without breaking hydration, so the first
  // paint is the default and this corrects it.
  useEffect(() => {
    const stored = read(NAME_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNameState(stored ?? agentName);
  }, [agentName]);

  useEffect(() => {
    if (!conversationId) return;
    const perThread = read(perConversationKey(conversationId));
    const fallback = read(DEFAULT_ON_KEY) === '1';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabledState(perThread === null ? fallback : perThread === '1');
  }, [conversationId]);

  const setName = useCallback((next: string) => {
    setNameState(next);
    write(NAME_KEY, next);
  }, []);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      if (conversationId)
        write(perConversationKey(conversationId), next ? '1' : '0');
      // The last thing they chose becomes the default for threads that have
      // never been asked — otherwise turning it on would be a per-thread
      // chore forever.
      write(DEFAULT_ON_KEY, next ? '1' : '0');
    },
    [conversationId]
  );

  return { name, setName, enabled, setEnabled };
}
