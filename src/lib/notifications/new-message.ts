import type { SupabaseClient } from '@supabase/supabase-js';

import { hasMinRole, type AccountRole } from '@/lib/auth/roles';

/**
 * Telling somebody a customer wrote.
 *
 * THE GAP THIS FILLS. The product has had exactly one notification type
 * since migration 027 — `conversation_assigned`, fired by a trigger when a
 * colleague hands you a thread — and nothing at all for an incoming message.
 * That is why the report was "ALGUMAS conversas não vêm notificação" rather
 * than "none do": the bell is demonstrably alive, so the conversations that
 * never announce themselves look like the broken ones.
 *
 * WHY THIS IS NOT A TRIGGER, which is where it started.
 *
 * `AFTER INSERT ON messages` fires for every row that table ever receives.
 * A broadcast writing three thousand outbound rows would call it three
 * thousand times so it could read `sender_type` and return — pure overhead
 * on the one path in this product that is already the slowest.
 *
 * Worse, on the path where it DID have work it did that work inside the
 * inbound message's own transaction: one INSERT per team member, holding
 * locks, while the statement that has to succeed for the message to exist at
 * all waited behind it. A notification is the least important thing
 * happening in that request and it was in front of everything else.
 *
 * Here it runs from the webhook's `after()` block — the same place the flow
 * runner, the automations and the public webhooks already run, after Meta
 * has been acked. It cannot slow the insert, it cannot fail it, and it does
 * not exist at all for the other ninety per cent of writes to `messages`.
 */

/** How long an announced conversation stays quiet. */
const BURST_WINDOW_MS = 5 * 60 * 1000;

/** Longest preview the bell will carry. */
const PREVIEW_MAX = 120;

export interface NewMessageNotificationArgs {
  accountId: string;
  conversationId: string;
  contactId: string;
  /** Owner of the thread, when it has one. */
  assignedAgentId: string | null | undefined;
  /** Display name for the bell's headline. */
  contactName: string | null | undefined;
  /** The customer's text, when the message had any. */
  text: string | null | undefined;
}

export type NotifyOutcome =
  'sent' | 'suppressed-burst' | 'no-recipients' | 'failed';

/**
 * Announce one inbound message, at most once per wait.
 *
 * Best-effort by construction: every failure path returns rather than
 * throwing, because the caller is midway through processing a WhatsApp
 * delivery and an exception there costs a redelivery of the whole message.
 */
export async function notifyNewInboundMessage(
  db: SupabaseClient,
  args: NewMessageNotificationArgs,
  now: number = Date.now()
): Promise<NotifyOutcome> {
  try {
    return await announce(db, args, now);
  } catch (error) {
    console.error(
      '[notify] new-message notification skipped:',
      error instanceof Error ? error.message : error
    );
    return 'failed';
  }
}

async function announce(
  db: SupabaseClient,
  args: NewMessageNotificationArgs,
  now: number
): Promise<NotifyOutcome> {
  // ONE PER WAIT, NOT ONE PER MESSAGE. Somebody typing five short lines is
  // one event that needs attention; five rows in the bell for it teaches
  // people to ignore the bell inside a day.
  //
  // The guard asks what was ANNOUNCED, not what was read. The obvious
  // version reads the conversation's `unread_count` — zero means "first of
  // the burst", since the webhook inserts before it bumps. It is wrong in a
  // way that is invisible: `MessageThread` resets that counter to zero on
  // every message that lands while an agent has the thread OPEN, so one
  // person reading a conversation makes all five messages look like the
  // first one, and everybody else gets five notifications — precisely in
  // the case where the thread is already being handled.
  const since = new Date(now - BURST_WINDOW_MS).toISOString();
  const { data: recent, error: recentError } = await db
    .from('notifications')
    .select('id')
    .eq('conversation_id', args.conversationId)
    .eq('type', 'new_message')
    .gte('created_at', since)
    .limit(1);

  // A failed read is not a reason to stay silent — the cost of a duplicate
  // notification is lower than the cost of a missed one, which is the whole
  // bug being fixed here.
  if (!recentError && recent && recent.length > 0) return 'suppressed-burst';

  const recipients = await resolveRecipients(db, args);
  if (recipients.length === 0) return 'no-recipients';

  const title = args.contactName?.trim() || 'Contato';
  const body = previewOf(args.text);

  // One statement for the whole fan-out. The trigger version issued an
  // `INSERT ... SELECT` per member inside somebody else's transaction; this
  // is a single round trip outside of one.
  const { error } = await db.from('notifications').insert(
    recipients.map((userId) => ({
      account_id: args.accountId,
      user_id: userId,
      type: 'new_message' as const,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      title,
      body,
    }))
  );

  if (error) {
    // Pre-046 the CHECK constraint still allows only `conversation_assigned`,
    // so this is where an un-migrated database lands. Logged, never thrown.
    console.error('[notify] could not write notifications:', error.message);
    return 'failed';
  }

  return 'sent';
}

/**
 * Who hears about it.
 *
 * The assigned agent, when there is one — it is their thread, and telling
 * the whole team about a conversation somebody is already holding is how a
 * bell becomes wallpaper.
 *
 * When nobody owns it, everyone who could pick it up. An unclaimed customer
 * waiting is exactly what a shared inbox exists to stop dropping, and
 * "somebody else will see it" is how it gets dropped.
 *
 * `viewer` is excluded from that fan-out on purpose. A read-only member
 * cannot answer, so a notification is a task they cannot act on — and they
 * are usually the largest group in an account, so including them makes the
 * fan-out both bigger and less useful at the same time.
 */
async function resolveRecipients(
  db: SupabaseClient,
  args: NewMessageNotificationArgs
): Promise<string[]> {
  if (args.assignedAgentId) return [args.assignedAgentId];

  const { data, error } = await db
    .from('profiles')
    .select('user_id, account_role')
    .eq('account_id', args.accountId);

  if (error || !data) return [];

  return (data as Array<{ user_id: string | null; account_role: AccountRole }>)
    .filter((p) => !!p.user_id && hasMinRole(p.account_role, 'agent'))
    .map((p) => p.user_id as string);
}

/**
 * A preview, not the message.
 *
 * The bell is a list of one-liners; a 900-character paste in one of them
 * pushes every other notification off the panel.
 */
function previewOf(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length <= PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, PREVIEW_MAX - 3)}...`;
}
