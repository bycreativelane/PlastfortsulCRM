import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeLastMessage } from './last-message';

/**
 * The row summary every send writes.
 *
 * The bug this closes is not "no thumbnail" — it is a thumbnail belonging
 * to a DIFFERENT message. `last_message_kind` and `last_message_media_url`
 * are not cleared by writing the text, so a bot answering a customer's
 * photo with a sentence left their photo sitting next to our words.
 */

interface Recorded {
  payload: Record<string, unknown> | null;
}

function stubClient(...errors: ({ message?: string; code?: string } | null)[]) {
  const calls: Recorded[] = [];

  const client = {
    from() {
      const rec: Recorded = { payload: null };
      const error = errors[calls.length] ?? null;
      calls.push(rec);
      const builder = {
        update(payload: Record<string, unknown>) {
          rec.payload = payload;
          return builder;
        },
        eq() {
          return builder;
        },
        then(onFulfilled: (v: { error: unknown }) => unknown) {
          return Promise.resolve({ error }).then(onFulfilled);
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

describe('writeLastMessage', () => {
  it('writes media alongside the preview text', async () => {
    const { client, calls } = stubClient();

    await writeLastMessage(client, 'conv-1', {
      text: 'Segue a nota',
      kind: 'document',
      mediaUrl: 'https://example.test/nota.pdf',
    });

    expect(calls[0].payload).toMatchObject({
      last_message_text: 'Segue a nota',
      last_message_kind: 'document',
      last_message_media_url: 'https://example.test/nota.pdf',
    });
  });

  it('clears the media on a text message, rather than omitting it', async () => {
    // The whole point. Omitting the column leaves the previous message's
    // photo on the row next to this sentence.
    const { client, calls } = stubClient();

    await writeLastMessage(client, 'conv-1', {
      text: 'Chega amanhã',
      kind: 'text',
    });

    expect(calls[0].payload).toHaveProperty('last_message_media_url', null);
    expect(calls[0].payload).toHaveProperty('last_message_kind', 'text');
  });

  it('carries the caller extras through', async () => {
    const { client, calls } = stubClient();

    await writeLastMessage(
      client,
      'conv-1',
      { text: 'oi', kind: 'text' },
      { status: 'open' }
    );

    expect(calls[0].payload).toMatchObject({ status: 'open' });
  });

  it('keeps the preview text when the 047 columns are missing', async () => {
    // Pre-047 the write fails on the unknown column. Dropping the text
    // with it would leave the list showing the customer's old message as
    // the newest, which reads as "the send failed".
    const { client, calls } = stubClient({
      code: 'PGRST204',
      message: "Could not find the 'last_message_kind' column",
    });

    await writeLastMessage(client, 'conv-1', { text: 'oi', kind: 'text' });

    expect(calls).toHaveLength(2);
    expect(calls[1].payload).toMatchObject({ last_message_text: 'oi' });
    expect(calls[1].payload).not.toHaveProperty('last_message_kind');
  });

  it('does not retry a failure that is not a missing column', async () => {
    const { client, calls } = stubClient({ message: 'permission denied' });

    await writeLastMessage(client, 'conv-1', { text: 'oi', kind: 'text' });

    expect(calls).toHaveLength(1);
  });
});
