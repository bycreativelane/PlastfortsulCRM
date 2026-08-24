import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { answeredPatch, markWaitingOnInbound } from './reopen';

/**
 * Cover for the rule three separate bug reports were describing.
 *
 * "Esperando" means the customer is waiting for an answer. So an inbound
 * message puts a thread there — from Entrada, from Finalizados, from
 * hidden — and an agent's reply is what takes it back out.
 *
 * These tests have been rewritten twice, which is worth recording. The
 * first version asserted that a `pending` conversation was left alone
 * (issue #409 only cared about `closed`). The second asserted that inbound
 * moved `pending` → `open`, which was the wrong reading of "cliente não
 * está saindo do esperando quando responde" — that sentence is about the
 * AGENT responding, not the customer. This is the third and it matches all
 * three reports at once.
 */

interface Recorded {
  table: string;
  payload: Record<string, unknown> | null;
  filters: [string, unknown][];
}

/**
 * Chainable stub shaped like the bit of postgrest this touches.
 *
 * `errors` is per call rather than one value, because the interesting case
 * is the second write succeeding after the first one failed — which is the
 * whole shape of the pre-migration fallback.
 */
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

describe('markWaitingOnInbound', () => {
  it.each(['open', 'closed'])(
    'moves a %s conversation to waiting',
    async (status) => {
      const { client, calls } = stubClient();

      const moved = await markWaitingOnInbound(client, {
        id: 'conv-1',
        status,
      });

      expect(moved).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].table).toBe('conversations');
      expect(calls[0].payload).toMatchObject({ status: 'pending' });
      expect(calls[0].payload).toHaveProperty('waiting_since');
      expect(calls[0].filters).toEqual([['id', 'conv-1']]);
    }
  );

  it('starts the clock when the wait starts', async () => {
    const { client, calls } = stubClient();

    await markWaitingOnInbound(client, { id: 'conv-1', status: 'open' });

    expect(calls[0].payload?.waiting_since).toEqual(expect.any(String));
  });

  it('does not restart the clock on the second message of a burst', async () => {
    // Four messages in a row are ONE wait. Re-stamping would make the
    // longest-neglected thread look freshest, which is the opposite of what
    // the Esperando tab sorts for.
    const { client, calls } = stubClient();

    const moved = await markWaitingOnInbound(client, {
      id: 'conv-1',
      status: 'pending',
    });

    expect(moved).toBe(false);
    expect(calls).toEqual([]);
  });

  it('un-hides a thread that was already waiting, without touching the clock', async () => {
    const { client, calls } = stubClient();

    const moved = await markWaitingOnInbound(client, {
      id: 'conv-1',
      status: 'pending',
      hidden_at: '2026-08-24T10:00:00Z',
    });

    expect(moved).toBe(true);
    expect(calls[0].payload).toMatchObject({
      hidden_at: null,
      hidden_by: null,
    });
    expect(calls[0].payload).not.toHaveProperty('waiting_since');
  });

  it('un-hides and starts waiting in one write', async () => {
    const { client, calls } = stubClient();

    await markWaitingOnInbound(client, {
      id: 'conv-1',
      status: 'closed',
      hidden_at: '2026-08-24T10:00:00Z',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({
      status: 'pending',
      hidden_at: null,
      hidden_by: null,
    });
  });

  it('still moves the thread when migration 045 has not been applied', async () => {
    // The columns land with 045, which Gabriel applies by hand. Between
    // shipping this and him running it the write fails on the unknown
    // column, and losing the transition would be a worse bug than the one
    // 045 fixes — so the status write is retried on its own.
    const { client, calls } = stubClient(
      { code: '42703', message: 'column "waiting_since" does not exist' },
      null
    );

    const moved = await markWaitingOnInbound(client, {
      id: 'conv-1',
      status: 'open',
    });

    expect(moved).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].payload).toEqual({
      status: 'pending',
      updated_at: expect.any(String),
    });
    expect(calls[1].payload).not.toHaveProperty('waiting_since');
  });

  it('reports failure without throwing when the update errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = stubClient({ message: 'boom' });

    const moved = await markWaitingOnInbound(client, {
      id: 'conv-1',
      status: 'open',
    });

    expect(moved).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('answeredPatch', () => {
  it('ends the wait and stops the clock', async () => {
    expect(answeredPatch()).toEqual({ status: 'open', waiting_since: null });
  });
});
