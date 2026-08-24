import type { SupabaseClient } from '@supabase/supabase-js';

import { isUnknownColumn } from '@/lib/supabase/pg-errors';

/**
 * The customer wrote. They are now waiting on us.
 *
 * WHAT "ESPERANDO" MEANS, because it took three bug reports to pin down and
 * one wrong implementation in between.
 *
 * It is not "unclaimed" — that was the original code, where the tab read
 * `!assigned_agent_id`. And it is not "parked by an agent" either, which is
 * what this file did in the first pass of the August review. It means the
 * customer is waiting for an answer:
 *
 *   customer sends a message   →  Esperando   (they are waiting on us)
 *   an agent replies           →  Entrada     (they are not any more)
 *   agent finishes the thread  →  Finalizados
 *
 * Read that way, all three reports are the same sentence: "cliente não está
 * saindo do esperando quando responde" is an agent's reply not clearing it,
 * "mensagens novas de clientes antigos não estão indo para esperando" and
 * "as que estão em entrada, quando mandam mensagem novamente não vai para
 * esperando" are this function not setting it. The manual "marcar como
 * esperando" in the row menu stays exactly as it is — an override on top of
 * an automatic state, not a replacement for one.
 *
 * The other half of the rule lives in `@/lib/whatsapp/send-message`, which
 * is the path a HUMAN reply takes. Automation and flow replies deliberately
 * do not clear it: an auto-reply saying "recebemos sua mensagem" has not
 * answered anybody, and a thread that quietly leaves the waiting queue
 * because a bot spoke is the exact failure the queue exists to prevent.
 *
 * ALSO CLEARS HIDING. A hidden conversation is one somebody pushed out of
 * the way, and the promise attached to hiding — rather than deleting — is
 * that it comes back on its own when the customer needs something. If that
 * promise needed a person to remember it, nobody would dare hide anything.
 *
 * Lives here rather than inline in the webhook so it can be tested without
 * standing up the whole route, and so any future inbound path gets the same
 * behaviour for free. (Automation dispatch is unaffected either way: it keys
 * on account + trigger + contact, never conversation status.)
 */
export async function markWaitingOnInbound(
  db: SupabaseClient,
  conversation: {
    id: string;
    status?: string | null;
    hidden_at?: string | null;
  }
): Promise<boolean> {
  try {
    return await moveToWaiting(db, conversation);
  } catch (error) {
    // "Best-effort" has to be enforced, not just intended. This runs inside
    // inbound webhook processing, and anything thrown here aborts the rest
    // of the message — flow dispatch, automations, the opt-out write — and
    // makes Meta redeliver the whole thing. A thread in the wrong tab is a
    // far smaller problem than a message delivered twice.
    console.error(
      'Error moving conversation to waiting:',
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

async function moveToWaiting(
  db: SupabaseClient,
  conversation: {
    id: string;
    status?: string | null;
    hidden_at?: string | null;
  }
): Promise<boolean> {
  const status = conversation.status;
  const alreadyWaiting = status === 'pending';
  const unhides = !!conversation.hidden_at;

  // Nothing to do for a visible thread that is already waiting, which is the
  // common case in a burst — five messages in a row are one wait, not five.
  // Skipping the round trip keeps inbound processing as cheap as it was.
  if (alreadyWaiting && !unhides) return false;

  const patch: Record<string, unknown> = {
    status: 'pending',
    updated_at: new Date().toISOString(),
  };

  if (!alreadyWaiting) {
    // Stamped only on the way IN. A customer who sends four messages has
    // been waiting since the first one, and restarting the clock on each
    // would keep the oldest, most neglected thread looking freshest —
    // which is the opposite of what the Esperando tab sorts for.
    patch.waiting_since = new Date().toISOString();
  }

  if (unhides) {
    patch.hidden_at = null;
    patch.hidden_by = null;
  }

  const { error } = await db
    .from('conversations')
    .update(patch)
    .eq('id', conversation.id);

  if (error) {
    // Best-effort, same as the conversation update this follows: a failed
    // write must not abort inbound processing (and make Meta redeliver).
    //
    // `waiting_since` / `hidden_at` are migration 045. Until it is applied
    // this write fails on the unknown column, and the fallback still does
    // the part that matters — the status — so an un-migrated database
    // degrades gracefully instead of losing the transition entirely.
    if (isUnknownColumn(error)) {
      const { error: fallbackError } = await db
        .from('conversations')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
      if (!fallbackError) return true;
    }
    console.error('Error moving conversation to waiting:', error);
    return false;
  }

  return true;
}

/**
 * A human answered, so nobody is waiting any more.
 *
 * Returns the patch rather than writing it: the one caller
 * (`send-message.ts`) is already updating the conversation row in the same
 * statement for `last_message_text`, and a second UPDATE against the same
 * row would be a wasted round trip on the hot path of sending a message.
 */
export function answeredPatch(): Record<string, unknown> {
  return { status: 'open', waiting_since: null };
}
