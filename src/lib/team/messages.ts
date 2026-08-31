import type { SupabaseClient } from '@supabase/supabase-js';

import { isUnknownColumn } from '@/lib/supabase/pg-errors';

/**
 * The team's own room.
 *
 * Every thread in this CRM is a conversation with somebody outside the
 * company. There has never been anywhere for the people INSIDE it to say
 * something to each other — so "o Cleiton ligou, vai buscar amanhã" gets said
 * in WhatsApp, on a phone, and the answer comes back somewhere the CRM will
 * never see it. What is lost is not the chat. It is that the sentence
 * explaining the order lives in a different application from the order.
 *
 * ONE ROOM, and see migration 046 for why: no channels, no membership, no
 * decision to make before you can type. And deliberately NOT a row in
 * `conversations` — every column on that table assumes a phone number at the
 * other end, and an internal note in there would be one `if` away from being
 * delivered to a customer.
 */

export interface TeamMessage {
  id: string;
  account_id: string;
  author_id: string;
  body: string;
  /** The customer thread being discussed, when there is one. */
  conversation_id: string | null;
  /**
   * Which room it was said in (migration 052). NULL means the account's
   * default room — every row written before 052 is one of those, and
   * `resolveRoomId` treats the two the same.
   */
  room_id: string | null;
  created_at: string;
  edited_at: string | null;
}

/**
 * The filter for "messages in this room", including the pre-052 rows.
 *
 * `room_id IS NULL` and `room_id = <the default room>` are the same
 * place, and every read of the default room has to say so or it shows an
 * empty history to an account that has been using the feature for
 * months. Spelled once, here, because there are three callers.
 */
export function roomFilter(roomId: string | null, isDefault: boolean): string {
  if (!roomId) return 'room_id.is.null';
  return isDefault ? `room_id.is.null,room_id.eq.${roomId}` : `room_id.eq.${roomId}`;
}

/** How many messages the room loads. */
export const TEAM_PAGE_SIZE = 200;

/** Marker for "the newest message this browser has already displayed". */
const SEEN_KEY = 'wacrm.team.lastSeen';

export const TEAM_SELECT = '*';

/**
 * `team_messages` arrives with migration 046, which is applied by hand.
 * PostgREST answers a missing relation with `PGRST205` (schema cache) or
 * Postgres `42P01` — the same pair `@/lib/occurrences/kinds` watches for.
 */
function isMissingTable(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return (
    /team_messages/i.test(error.message ?? '') &&
    /(does not exist|could not find)/i.test(error.message ?? '')
  );
}

/**
 * The room's history, oldest last in the array so the caller can render it
 * top-to-bottom the way every other thread in this app does.
 *
 * Capped rather than paged. A team room is read by scrolling to the bottom
 * and looking up a screen or two; "load older" is a control that would be
 * used roughly never, and 200 rows is well under what one fetch can carry.
 */
export async function loadTeamMessages(
  db: SupabaseClient,
  accountId: string,
  room?: { id: string | null; isDefault: boolean }
): Promise<TeamMessage[] | 'missing-table'> {
  let query = db
    .from('team_messages')
    .select(TEAM_SELECT)
    .eq('account_id', accountId);

  // No room given means "everything", which is what a database without
  // 052 has anyway. Asking for a room the schema does not know about
  // would 42703 the whole read.
  if (room) query = query.or(roomFilter(room.id, room.isDefault));

  const { data, error } = await query
    // Newest first in SQL so the LIMIT keeps the recent end of the history
    // rather than the beginning — then reversed for display.
    .order('created_at', { ascending: false })
    .limit(TEAM_PAGE_SIZE);

  if (error) {
    // "No table" and "no messages" are different answers and the room has
    // to say which. Returning `[]` for both drew the empty state — "nada
    // por aqui ainda" — over a room that does not exist, which is the
    // worst of the three possible screens: it tells somebody the feature
    // works and nobody has used it, so they type a message and watch it
    // vanish.
    if (isMissingTable(error)) return 'missing-table';

    console.error('Failed to load team messages:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return [];
  }

  return ((data ?? []) as TeamMessage[]).reverse();
}

export async function sendTeamMessage(
  db: SupabaseClient,
  args: {
    accountId: string;
    authorId: string;
    body: string;
    conversationId?: string | null;
    /** Omit (or null) on a pre-052 database — see the retry below. */
    roomId?: string | null;
  }
): Promise<{ error: string | null }> {
  const body = args.body.trim();
  if (!body) return { error: null };

  const row: Record<string, unknown> = {
    account_id: args.accountId,
    author_id: args.authorId,
    body,
    conversation_id: args.conversationId ?? null,
  };
  if (args.roomId) row.room_id = args.roomId;

  const { error } = await db.from('team_messages').insert(row);
  if (error && args.roomId && isUnknownColumn(error)) {
    // 052 has not been applied. The room the composer thinks it is in
    // does not exist yet, and the ONE thing that must not happen is the
    // message vanishing — so it goes to the room that has always been
    // there.
    const { error: retryError } = await db.from('team_messages').insert({
      account_id: args.accountId,
      author_id: args.authorId,
      body,
      conversation_id: args.conversationId ?? null,
    });
    return { error: retryError?.message ?? null };
  }

  return { error: error?.message ?? null };
}

/**
 * How many messages arrived after this browser last looked.
 *
 * A COUNT and not a dot, which reverses the decision written next to the
 * card — "how many unread lines are in it is not a number anybody acts on
 * differently". That was a judgement about a room nobody had used yet.
 * Used, the number is the difference between "somebody said something"
 * and "you have missed a conversation", and those are acted on very
 * differently.
 *
 * `head: true` so nothing crosses the wire but the count.
 */
export async function countUnreadTeamMessages(
  db: SupabaseClient,
  accountId: string,
  since: string | null,
  room?: { id: string | null; isDefault: boolean }
): Promise<number> {
  if (!since) return 0;
  let query = db
    .from('team_messages')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .gt('created_at', since);
  if (room) query = query.or(roomFilter(room.id, room.isDefault));

  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

/**
 * Fix a typo without leaving the room.
 *
 * `edited_at` has been on the table since 046 and until now nothing wrote it
 * — the column was listed in the pending notes as dead weight. It is not
 * dead, it was unwired: an internal room is where somebody types a customer's
 * name wrong and a colleague acts on it, and "ignora, era o outro Cleiton" as
 * a SECOND message leaves both sentences in the history for whoever scrolls
 * past next week.
 *
 * The stamp is what earns the edit. A message that can change silently is a
 * message nobody can quote, so every edit marks itself and the room draws the
 * mark — see `editedLabel` in the channel.
 *
 * RLS decides who may: `team_messages_update` (046, tightened by 048) allows
 * the author and nobody else. This function does not re-check that, because a
 * client-side check that disagrees with the database is a bug waiting for a
 * schema change.
 */
export async function editTeamMessage(
  db: SupabaseClient,
  args: { id: string; body: string }
): Promise<{ error: string | null }> {
  const body = args.body.trim();
  if (!body) return { error: 'empty' };

  const { error } = await db
    .from('team_messages')
    .update({ body, edited_at: new Date().toISOString() })
    .eq('id', args.id);

  return { error: error?.message ?? null };
}

/**
 * Take it back.
 *
 * A hard delete, not a tombstone. WhatsApp's "esta mensagem foi apagada"
 * exists because the other end already received it on their phone and the
 * absence would be spooky; here the room is one table both people are looking
 * at live, and a row that is gone is gone from both screens in the same
 * second. Leaving a headstone behind would be keeping the interruption and
 * throwing away the content, which is the wrong half.
 *
 * `team_messages_delete` (046) allows the author OR an admin — the second
 * branch is what lets somebody senior clear a message that should not be in
 * an internal log at all.
 */
export async function deleteTeamMessage(
  db: SupabaseClient,
  id: string
): Promise<{ error: string | null }> {
  const { error } = await db.from('team_messages').delete().eq('id', id);
  return { error: error?.message ?? null };
}

/**
 * Whether the room has something this browser has not seen.
 *
 * `localStorage` and not a database column, for the same reason the composer
 * signature lives there: per-person-per-device read state would need a row
 * per member per message to do properly, and what the dot has to answer is
 * only "is there anything new since I last looked". Comparing the newest
 * message's timestamp against a stored one answers exactly that, costs
 * nothing, and is wrong in the harmless direction — a second browser shows
 * the dot again.
 */
export function lastSeenTeamMessage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    // Safari in private mode throws on access, not on write.
    return null;
  }
}

/**
 * Fired when the marker moves, so every surface showing a dot can re-derive
 * it.
 *
 * `localStorage` is not reactive, and the two places that draw the dot — the
 * rail's card and the conversation list's row — read it once when they
 * mount. Reading the room updated the marker and told nobody, so the rail
 * kept its dot lit until a full navigation happened to remount the card. A
 * dot that stays on after you have read the thing it points at is worse than
 * no dot: it trains you to ignore it.
 *
 * A window event rather than a store because the readers are in different
 * trees with no common provider, and because `storage` events fire in OTHER
 * tabs, never the one that wrote.
 */
export const TEAM_SEEN_EVENT = 'wacrm:team-seen';

export function markTeamRoomSeen(newestCreatedAt: string | null): void {
  if (typeof window === 'undefined' || !newestCreatedAt) return;
  try {
    window.localStorage.setItem(SEEN_KEY, newestCreatedAt);
  } catch {
    /* A preference that cannot be stored is not worth an error. */
  }
  window.dispatchEvent(new CustomEvent(TEAM_SEEN_EVENT));
}

/**
 * Unread if the newest message is newer than the marker.
 *
 * A room nobody has ever opened counts as unread when it HAS messages, and
 * as read when it is empty — an empty room has nothing to announce, and a
 * dot on it on day one would be a dot that means nothing.
 */
export function hasUnreadTeamMessages(
  newestCreatedAt: string | null,
  seen: string | null
): boolean {
  if (!newestCreatedAt) return false;
  if (!seen) return true;
  return newestCreatedAt > seen;
}
