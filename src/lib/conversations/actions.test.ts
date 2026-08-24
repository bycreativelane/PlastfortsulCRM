import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { assignConversation, setConversationStatus } from './actions';

/**
 * The manual overrides behind the conversation menu.
 *
 * The rule under test is the one `reopen.ts` has always enforced on the
 * inbound side and this file did not: `waiting_since` means "since THIS
 * wait", so a thread already in Esperando must not have its clock reset
 * by somebody choosing "Marcar como esperando" again. Esperando is the
 * only list in this product sorted oldest-first, so re-stamping moved the
 * most neglected conversation to the bottom of the one view built to
 * surface it.
 */

interface Recorded {
  table: string;
  payload: Record<string, unknown> | null;
  filters: [string, unknown][];
}

function stubClient(...errors: ({ message?: string; code?: string } | null)[]) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const rec: Recorded = { table, payload: null, filters: [] };
      const error = errors[calls.length] ?? null;
      calls.push(rec);
      const builder = {
        update(payload: Record<string, unknown>) {
          rec.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          rec.filters.push([column, value]);
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

describe('setConversationStatus', () => {
  it('starts the clock when a thread enters Esperando', async () => {
    const { client, calls } = stubClient();

    const { patch } = await setConversationStatus(
      client,
      'conv-1',
      'pending',
      'open'
    );

    expect(patch.status).toBe('pending');
    expect(patch.waiting_since).toEqual(expect.any(String));
    expect(calls[0].filters).toEqual([['id', 'conv-1']]);
  });

  it('leaves the clock alone on a thread already waiting', async () => {
    // The reported shape: a thread parked since Thursday, re-parked today.
    // Writing `waiting_since` here would make the oldest row in the queue
    // look like the newest.
    const { client, calls } = stubClient();

    const { patch } = await setConversationStatus(
      client,
      'conv-1',
      'pending',
      'pending'
    );

    expect(patch.status).toBe('pending');
    expect(patch).not.toHaveProperty('waiting_since');
    expect(calls[0].payload).not.toHaveProperty('waiting_since');
  });

  it.each(['open', 'closed'] as const)(
    'clears the clock on the way out to %s',
    async (next) => {
      const { client } = stubClient();

      const { patch } = await setConversationStatus(
        client,
        'conv-1',
        next,
        'pending'
      );

      expect(patch.waiting_since).toBeNull();
    }
  );

  it('still stamps when the caller does not know the current status', async () => {
    // The argument is optional so an older call site keeps compiling. With
    // nothing to compare against, the safe answer is the old behaviour.
    const { client } = stubClient();

    const { patch } = await setConversationStatus(client, 'conv-1', 'pending');

    expect(patch.waiting_since).toEqual(expect.any(String));
  });

  it('keeps the status change when the timestamp column is missing', async () => {
    // Pre-045. Losing the move because the clock could not be written
    // would be the wrong trade — the operator asked for the move.
    const { client, calls } = stubClient({
      code: 'PGRST204',
      message: "Could not find the 'waiting_since' column",
    });

    const { error, patch } = await setConversationStatus(
      client,
      'conv-1',
      'pending',
      'open'
    );

    expect(error).toBeNull();
    expect(patch).toEqual({ status: 'pending' });
    expect(calls).toHaveLength(2);
  });
});

describe('assignConversation', () => {
  it('reports the owner it wrote', async () => {
    const { client, calls } = stubClient();

    const { error, patch } = await assignConversation(
      client,
      'conv-1',
      'user-9'
    );

    expect(error).toBeNull();
    expect(patch).toEqual({ assigned_agent_id: 'user-9' });
    expect(calls[0].payload).toMatchObject({ assigned_agent_id: 'user-9' });
  });

  it('treats null as a real value, not a no-op', async () => {
    // "Back in the unassigned pool" is the move you make when you picked
    // something up by mistake, and it is what lets the rotation hand the
    // thread out again.
    const { client, calls } = stubClient();

    const { patch } = await assignConversation(client, 'conv-1', null);

    expect(patch).toEqual({ assigned_agent_id: null });
    expect(calls[0].payload).toHaveProperty('assigned_agent_id', null);
  });

  it('surfaces a write failure instead of reporting a patch', async () => {
    const { client } = stubClient({ message: 'permission denied' });

    const { error, patch } = await assignConversation(client, 'conv-1', 'u-1');

    expect(error).toBe('permission denied');
    expect(patch).toEqual({});
  });
});
