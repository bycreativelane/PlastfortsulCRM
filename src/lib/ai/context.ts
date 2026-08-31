import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  /** Words for an attachment, from migration 049. */
  media_transcript?: string | null
  content_text: string | null
}

/**
 * Fetch the last N messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`.
 *
 * A turn counts when it has WORDS, from either column: what was typed,
 * or — since migration 049 — what was said in an audio and transcribed.
 * Anything still wordless (a photo nobody described, a template with no
 * body) contributes nothing, which is what it did before.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, media_transcript')
    .eq('conversation_id', conversationId)
    // NOT `.eq('content_type', 'text')` any more.
    //
    // That filter meant the assistant read a conversation with every
    // voice note cut out of it — so a customer who explained the whole
    // problem by audio and then typed "e aí?" got an answer to "e aí?"
    // with no idea what came before. Migration 049 put the words in
    // `media_transcript`; this is where they earn their keep.
    //
    // The `filter` below still drops anything with no words in it, so a
    // photo with no caption and no description contributes nothing —
    // which is the same as being filtered out, without also throwing
    // away the audio next to it.
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .map((m) => ({
      role: (m.sender_type === 'customer' ? 'user' : 'assistant') as
        | 'user'
        | 'assistant',
      // Typed text wins: a captioned photo has both, and the caption is
      // what the person chose to say about it.
      content: (m.content_text?.trim() || m.media_transcript?.trim() || '')
        .trim(),
    }))
    .filter((m) => m.content.length > 0)
}
