import type { SupabaseClient } from '@supabase/supabase-js';

import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import type { Conversation, ConversationStatus } from '@/types';

/**
 * The writes behind the conversation menu.
 *
 * Gathered here rather than inlined in the menu component because three
 * different surfaces do the same things — the row's right-click menu, the
 * thread header's overflow menu, and the status dropdown that was already
 * there — and a rule like "parking a thread starts its clock" has to be true
 * in all of them or it is true in none.
 *
 * Every function returns the patch it wrote so the caller can apply the same
 * change to its local state without a refetch. The inbox holds every
 * conversation in memory and re-sorts on each change; going back to the
 * database for a row we just wrote would be a visible delay on an action
 * that should feel instant.
 */

export type ConversationPatch = Partial<Conversation>;

interface Result {
  error: string | null;
  patch: ConversationPatch;
}

const ok = (patch: ConversationPatch): Result => ({ error: null, patch });
const failed = (error: string): Result => ({ error, patch: {} });

/**
 * Move a conversation between open / pending / closed, by hand.
 *
 * THE OVERRIDE, not the mechanism. The state moves on its own — a customer
 * writing sends a thread to Esperando and an agent replying brings it back
 * (see `@/lib/conversations/reopen`) — and this is how a person disagrees
 * with that: putting a thread back in the queue for a colleague without
 * answering it, taking it out because the answer went out by phone,
 * finishing it.
 *
 * `waiting_since` is the reason this is not a one-line update. "Esperando"
 * without a date is a list that cannot be sorted by the only thing that
 * matters about it — a thread waiting an hour and one waiting since last
 * Thursday look identical, and it is the second one somebody has to be
 * shown. Stamped on the way in, cleared on the way out, so it always means
 * "since this wait" and never "since some wait".
 */
export async function setConversationStatus(
  db: SupabaseClient,
  conversationId: string,
  status: ConversationStatus,
  /**
   * What the row says right now. Optional so an older caller still
   * compiles, and passed by both of the real ones.
   */
  currentStatus?: ConversationStatus | null
): Promise<Result> {
  // Already parked? Leave the clock alone.
  //
  // `markWaitingOnInbound` has guarded this since it was written — a
  // customer who sends four messages has been waiting since the FIRST — and
  // the manual path did not, so re-parking an already-waiting thread reset
  // it to now. The Esperando tab is the one list in this product sorted
  // oldest-first, which means the effect of that write was to take the most
  // neglected conversation in the queue and move it to the bottom: the
  // exact row the tab exists to surface, hidden by the control meant to
  // manage it.
  const alreadyWaiting = status === 'pending' && currentStatus === 'pending';

  const patch: ConversationPatch = { status };
  if (!alreadyWaiting) {
    patch.waiting_since =
      status === 'pending' ? new Date().toISOString() : null;
  }

  const { error } = await db
    .from('conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (error) {
    // Pre-045 the column is not there. The status change is the part the
    // operator asked for; losing it because the timestamp could not be
    // written would be the wrong trade.
    if (isUnknownColumn(error)) {
      const { error: retry } = await db
        .from('conversations')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', conversationId);
      if (!retry) return ok({ status });
      return failed(retry.message);
    }
    return failed(error.message);
  }

  return ok(patch);
}

/**
 * Hand a thread to somebody, or take it off everybody.
 *
 * The row menu promised this from the day it was written — "Atribuir a…"
 * was in the component and in three locale files — and never rendered,
 * because the one prop that switched it on had no call site. So handing a
 * conversation to a colleague meant opening it first, which is the exact
 * shape of friction this menu exists to remove: everything you can do to a
 * conversation without opening it.
 *
 * `null` is a real value here, not a failure — "back in the unassigned
 * pool" is the move you make when you picked something up by mistake.
 */
export async function assignConversation(
  db: SupabaseClient,
  conversationId: string,
  agentId: string | null
): Promise<Result> {
  const patch: ConversationPatch = { assigned_agent_id: agentId };

  const { error } = await db
    .from('conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (error) return failed(error.message);
  return ok(patch);
}

/**
 * Push a conversation out of the lists without destroying anything.
 *
 * The answer to "some option to delete chat" that covers the case people
 * actually have most days: this thread is finished, is cluttering a list of
 * ten, and nobody wants its history gone. It comes back on its own the
 * moment the customer writes again (see `markWaitingOnInbound`), which is what
 * makes it safe to reach for without thinking.
 */
export async function hideConversation(
  db: SupabaseClient,
  conversationId: string,
  userId: string | null
): Promise<Result> {
  const patch: ConversationPatch = {
    hidden_at: new Date().toISOString(),
    hidden_by: userId ?? null,
  };

  const { error } = await db
    .from('conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  // No fallback here, unlike the status write: there is no partial version
  // of hiding. Pre-045 the caller shows "this needs migration 045" rather
  // than a database string.
  if (error) return failed(error.message);
  return ok(patch);
}

export async function unhideConversation(
  db: SupabaseClient,
  conversationId: string
): Promise<Result> {
  const patch: ConversationPatch = { hidden_at: null, hidden_by: null };

  const { error } = await db
    .from('conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (error) return failed(error.message);
  return ok(patch);
}

/**
 * Put the unread badge back.
 *
 * "Marcar como não lida" is not bookkeeping — in a shared mailbox it is how
 * one person hands a thread back to the queue after opening it by mistake,
 * or flags it for themselves at the end of a shift. The count is set to 1
 * rather than restored, because the number was already destroyed by opening
 * it and inventing the old one would be a lie; what the badge means here is
 * "look again", not "you have four messages".
 */
export async function markConversationUnread(
  db: SupabaseClient,
  conversationId: string
): Promise<Result> {
  const patch: ConversationPatch = { unread_count: 1 };

  const { error } = await db
    .from('conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (error) return failed(error.message);
  return ok(patch);
}

/**
 * Destroy the conversation and every message in it.
 *
 * `messages` is ON DELETE CASCADE (migration 001), so this is not "remove
 * the row from a list" — it is the only irreversible act in the inbox.
 * Migration 045 restricts the RLS policy to admins, which is the guard that
 * actually holds: the menu hiding the item is a courtesy, and PostgREST is
 * reachable with any signed-in session's token.
 *
 * Kept for the cases hiding cannot answer — a test thread, a wrong number,
 * an erasure request — and nothing else.
 */
export async function deleteConversation(
  db: SupabaseClient,
  conversationId: string
): Promise<{ error: string | null }> {
  const { error } = await db
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  return { error: error?.message ?? null };
}
