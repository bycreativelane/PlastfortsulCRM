import type { SupabaseClient } from '@supabase/supabase-js';

import { isUnknownColumn } from '@/lib/supabase/pg-errors';

/**
 * The row summary a conversation shows in the list, written by every send.
 *
 * Migration 047 added `last_message_kind` and `last_message_media_url` so a
 * row can draw a thumbnail instead of the word `[image]`. The webhook and
 * the agent's own send path were updated with it; the FOUR BOT PATHS were
 * not — flow text, flow media, flow interactive, and the automation send —
 * and each of them wrote `last_message_text` alone.
 *
 * What that produced is worse than a missing thumbnail. The two new columns
 * are not cleared by writing the text, so a customer sends a photo, an
 * automation answers with a sentence, and the row keeps THEIR photo next to
 * OUR sentence — a thumbnail that belongs to a different message, which is
 * the one kind of wrong a preview must never be. A flow that sends a
 * document had the mirror problem: an attachment the row could not show.
 *
 * `null` rather than omitted, always: omitting a column leaves whatever was
 * there before, and "there is no media on this one" is a fact that has to be
 * written down.
 *
 * PRE-047 SAFETY, same trade as `send-message.ts`: on an un-migrated
 * database the write fails on the unknown column, and losing the preview
 * text with it would make the list show the customer's old message as the
 * newest — which reads as "the send failed" when it did not. So the retry
 * drops the two new fields and keeps everything else.
 */
export async function writeLastMessage(
  db: SupabaseClient,
  conversationId: string,
  summary: {
    /** What the list prints when there is no thumbnail. */
    text: string;
    /** `messages.content_type` of what was just sent. */
    kind: string;
    /** Only a media send has one. */
    mediaUrl?: string | null;
  },
  /** Anything else the caller writes in the same statement. */
  extra: Record<string, unknown> = {}
): Promise<void> {
  const now = new Date().toISOString();
  const base = {
    last_message_text: summary.text,
    last_message_at: now,
    updated_at: now,
    ...extra,
  };

  const { error } = await db
    .from('conversations')
    .update({
      ...base,
      last_message_kind: summary.kind,
      last_message_media_url: summary.mediaUrl ?? null,
    })
    .eq('id', conversationId);

  if (error && isUnknownColumn(error)) {
    await db.from('conversations').update(base).eq('id', conversationId);
  }
}
