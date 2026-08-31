import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  /**
   * The half of migration 049 that was missing.
   *
   * The query used to carry `.eq('content_type', 'text')`, so the model
   * read a conversation with every voice note cut out of it: a customer
   * who explained the whole problem by audio and then typed "e aí?" got
   * an answer to "e aí?" alone. The words were in `media_transcript` the
   * whole time.
   */
  it('reads a transcribed audio as a turn', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: 'e aí?' },
        {
          sender_type: 'customer',
          content_text: null,
          media_transcript: 'preciso de mil sacos de 40x60',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: 'preciso de mil sacos de 40x60' },
      { role: 'user', content: 'e aí?' },
    ])
  })

  it('prefers the typed caption over the description of the photo', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_text: 'segue a foto do lote',
          media_transcript: 'Foto de um fardo de sacos empilhado.',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'segue a foto do lote' }])
  })

  it('still drops an attachment nobody could describe', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: null, media_transcript: null },
        { sender_type: 'customer', content_text: 'oi' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'oi' }])
  })
})
