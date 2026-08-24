import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyNewInboundMessage } from './new-message';

/**
 * Cover for "algumas conversas não vêm notificação" — which turned out to be
 * "none do", because the only notification type the product had was
 * assignment (migration 027).
 *
 * And for the two ways the first implementation was wrong: it lived in an
 * `AFTER INSERT` trigger on `messages` (firing on every broadcast row, and
 * fanning out inside the inbound insert's transaction), and its burst guard
 * read `unread_count`, which `MessageThread` resets to zero on every message
 * that lands while an agent has the thread open.
 */

interface Stub {
  /** Rows the burst-guard SELECT resolves with. */
  recent?: { id: string }[];
  recentError?: { message: string } | null;
  profiles?: Array<{ user_id: string | null; account_role: string }>;
  insertError?: { message: string } | null;
}

function stubClient(config: Stub = {}) {
  const inserted: Record<string, unknown>[][] = [];
  const filters: Array<[string, unknown]> = [];

  const client = {
    from(table: string) {
      if (table === 'notifications') {
        return {
          select: () => {
            const chain: Record<string, unknown> = {};
            chain.eq = (column: string, value: unknown) => {
              filters.push([column, value]);
              return chain;
            };
            chain.gte = (column: string, value: unknown) => {
              filters.push([column, value]);
              return chain;
            };
            chain.limit = () =>
              Promise.resolve({
                data: config.recent ?? [],
                error: config.recentError ?? null,
              });
            return chain;
          },
          insert: (rows: Record<string, unknown>[]) => {
            inserted.push(rows);
            return Promise.resolve({ error: config.insertError ?? null });
          },
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({ data: config.profiles ?? [], error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { client: client as unknown as SupabaseClient, inserted, filters };
}

const ARGS = {
  accountId: 'acc-1',
  conversationId: 'conv-1',
  contactId: 'ct-1',
  assignedAgentId: null,
  contactName: 'Cleiton',
  text: 'Precisando de sacarias',
};

describe('notifyNewInboundMessage', () => {
  it('tells the assigned agent, and only them', async () => {
    // The thread has an owner. Telling the whole team about a conversation
    // somebody is already holding is how a bell becomes wallpaper.
    const { client, inserted } = stubClient();

    const outcome = await notifyNewInboundMessage(client, {
      ...ARGS,
      assignedAgentId: 'agent-1',
    });

    expect(outcome).toBe('sent');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(1);
    expect(inserted[0][0]).toMatchObject({
      user_id: 'agent-1',
      type: 'new_message',
      conversation_id: 'conv-1',
      title: 'Cleiton',
      body: 'Precisando de sacarias',
    });
  });

  it('fans out to everyone who could pick up an unclaimed thread', async () => {
    const { client, inserted } = stubClient({
      profiles: [
        { user_id: 'owner-1', account_role: 'owner' },
        { user_id: 'admin-1', account_role: 'admin' },
        { user_id: 'agent-1', account_role: 'agent' },
      ],
    });

    await notifyNewInboundMessage(client, ARGS);

    // ONE statement for the whole fan-out — the trigger version issued an
    // INSERT per member inside somebody else's transaction.
    expect(inserted).toHaveLength(1);
    expect(inserted[0].map((r) => r.user_id)).toEqual([
      'owner-1',
      'admin-1',
      'agent-1',
    ]);
  });

  it('leaves viewers out of the fan-out', async () => {
    // A read-only member cannot answer, so the notification is a task they
    // cannot act on — and viewers are usually the largest group.
    const { client, inserted } = stubClient({
      profiles: [
        { user_id: 'agent-1', account_role: 'agent' },
        { user_id: 'viewer-1', account_role: 'viewer' },
      ],
    });

    await notifyNewInboundMessage(client, ARGS);

    expect(inserted[0].map((r) => r.user_id)).toEqual(['agent-1']);
  });

  it('stays quiet for the rest of a burst', async () => {
    const { client, inserted } = stubClient({ recent: [{ id: 'notif-1' }] });

    const outcome = await notifyNewInboundMessage(client, ARGS);

    expect(outcome).toBe('suppressed-burst');
    expect(inserted).toEqual([]);
  });

  it('asks what was announced, not what was read', async () => {
    // The regression that matters: the first version keyed the burst guard
    // on `conversations.unread_count`, which the open thread resets to zero
    // on every message — so five messages each looked like the first one.
    // This guard never touches that table.
    const { client, filters } = stubClient();

    await notifyNewInboundMessage(
      client,
      ARGS,
      Date.parse('2026-08-24T12:00:00Z')
    );

    expect(filters).toContainEqual(['conversation_id', 'conv-1']);
    expect(filters).toContainEqual(['type', 'new_message']);
    expect(filters).toContainEqual(['created_at', '2026-08-24T11:55:00.000Z']);
  });

  it('speaks up when the burst check itself fails', async () => {
    // A duplicate notification costs less than a missed one, which is the
    // entire bug being fixed here.
    const { client, inserted } = stubClient({
      recentError: { message: 'timeout' },
      profiles: [{ user_id: 'agent-1', account_role: 'agent' }],
    });

    const outcome = await notifyNewInboundMessage(client, ARGS);

    expect(outcome).toBe('sent');
    expect(inserted).toHaveLength(1);
  });

  it('carries a preview rather than the whole message', async () => {
    const { client, inserted } = stubClient({
      profiles: [{ user_id: 'agent-1', account_role: 'agent' }],
    });

    await notifyNewInboundMessage(client, { ...ARGS, text: 'x'.repeat(400) });

    const body = inserted[0][0].body as string;
    expect(body).toHaveLength(120);
    expect(body.endsWith('...')).toBe(true);
  });

  it('leaves the body null for a message with no text', async () => {
    // A photo with no caption. The interface fills in "mandou um anexo".
    const { client, inserted } = stubClient({
      profiles: [{ user_id: 'agent-1', account_role: 'agent' }],
    });

    await notifyNewInboundMessage(client, { ...ARGS, text: null });

    expect(inserted[0][0].body).toBeNull();
  });

  it('writes nothing when the account has nobody who can answer', async () => {
    const { client, inserted } = stubClient({
      profiles: [{ user_id: 'viewer-1', account_role: 'viewer' }],
    });

    const outcome = await notifyNewInboundMessage(client, ARGS);

    expect(outcome).toBe('no-recipients');
    expect(inserted).toEqual([]);
  });

  it('never throws, whatever the database does', async () => {
    // It runs midway through processing a WhatsApp delivery: an exception
    // here costs a redelivery of the entire message.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = {
      from() {
        throw new Error('connection reset');
      },
    } as unknown as SupabaseClient;

    await expect(notifyNewInboundMessage(client, ARGS)).resolves.toBe('failed');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reports failure when the insert is rejected', async () => {
    // Pre-046 the CHECK constraint still allows only `conversation_assigned`.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = stubClient({
      profiles: [{ user_id: 'agent-1', account_role: 'agent' }],
      insertError: { message: 'violates check constraint' },
    });

    const outcome = await notifyNewInboundMessage(client, ARGS);

    expect(outcome).toBe('failed');
    spy.mockRestore();
  });
});
