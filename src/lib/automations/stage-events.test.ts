import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  dispatch: vi.fn(async () => {}),
  cancel: vi.fn(async () => 0),
}));

vi.mock('./engine', () => ({ runAutomationsForTrigger: h.dispatch }));
vi.mock('./cancel', () => ({ cancelPendingOnStageEnter: h.cancel }));

import { MAX_EVENTS_PER_HOUR, drainDealStageEvents } from './stage-events';

interface Event {
  id: string;
  account_id: string;
  deal_id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  changed_by: string | null;
  changed_at: string;
  dispatched_at: string | null;
}

function fakeDb(
  events: Event[],
  deals: Record<
    string,
    {
      id: string;
      contact_id: string | null;
      pipeline_id: string;
      account_id: string;
    }
  >,
  recentCount = 1
): SupabaseClient {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let type: 'select' | 'update' = 'select';
      let payload: Record<string, unknown> = {};
      let head = false;
      const b: Record<string, unknown> = {};
      const resolve = () => {
        if (table === 'deal_stage_events') {
          if (type === 'update') {
            const id = filters.find(([k]) => k === 'id')?.[1];
            const ev = events.find((e) => e.id === id);
            if (ev && ev.dispatched_at === null) {
              ev.dispatched_at = String(payload.dispatched_at);
              return { data: { id: ev.id }, error: null };
            }
            return { data: null, error: null };
          }
          if (head) return { data: null, error: null, count: recentCount };
          return {
            data: events.filter((e) => e.dispatched_at === null),
            error: null,
          };
        }
        if (table === 'deals') {
          const id = filters.find(([k]) => k === 'id')?.[1];
          return { data: deals[String(id)] ?? null, error: null };
        }
        return { data: null, error: null };
      };
      Object.assign(b, {
        select: (_cols?: string, opts?: { head?: boolean }) => (
          (head = !!opts?.head),
          b
        ),
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        is: () => b,
        gte: () => b,
        order: () => b,
        limit: () => b,
        update: (p: Record<string, unknown>) => (
          (type = 'update'),
          (payload = p),
          b
        ),
        maybeSingle: async () => resolve(),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(resolve()).then(onF, onR),
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

function event(partial: Partial<Event> & { id: string }): Event {
  return {
    account_id: 'acct',
    deal_id: 'd1',
    from_stage_id: 's-old',
    to_stage_id: 's-new',
    changed_by: 'u1',
    changed_at: '2026-09-02T12:00:00Z',
    dispatched_at: null,
    ...partial,
  };
}

const DEALS = {
  d1: { id: 'd1', contact_id: 'c1', pipeline_id: 'p1', account_id: 'acct' },
  d2: { id: 'd2', contact_id: null, pipeline_id: 'p1', account_id: 'acct' },
};

beforeEach(() => {
  h.dispatch.mockClear();
  h.cancel.mockClear();
});

describe('drainDealStageEvents', () => {
  it('claims the event, applies the cancellation rule, then fires the trigger with the deal in context', async () => {
    const events = [event({ id: 'e1' })];
    const result = await drainDealStageEvents(100, fakeDb(events, DEALS));

    expect(result).toEqual({ processed: 1, dispatched: 1, suppressed: 0 });
    expect(events[0].dispatched_at).not.toBeNull();
    expect(h.cancel).toHaveBeenCalledWith(expect.anything(), {
      accountId: 'acct',
      dealId: 'd1',
      stageId: 's-new',
    });
    expect(h.dispatch).toHaveBeenCalledWith({
      accountId: 'acct',
      triggerType: 'deal_stage_entered',
      contactId: 'c1',
      context: {
        deal_id: 'd1',
        stage_id: 's-new',
        from_stage_id: 's-old',
        stage_event_id: 'e1',
      },
    });
    // Cancel before dispatch — the order the spec requires.
    expect(h.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      h.dispatch.mock.invocationCallOrder[0]
    );
  });

  it('leaves an event another tick already claimed alone', async () => {
    const events = [event({ id: 'e1', dispatched_at: '2026-09-02T12:00:30Z' })];
    // The select already filters it out; the claim would too.
    const result = await drainDealStageEvents(100, fakeDb(events, DEALS));
    expect(result.processed).toBe(0);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('still cancels, but fires nothing, for a deal whose contact is gone', async () => {
    const events = [event({ id: 'e2', deal_id: 'd2' })];
    const result = await drainDealStageEvents(100, fakeDb(events, DEALS));
    expect(result.processed).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('suppresses the trigger for a deal changing stage faster than a funnel ever does', async () => {
    const events = [event({ id: 'e1' })];
    const result = await drainDealStageEvents(
      100,
      fakeDb(events, DEALS, MAX_EVENTS_PER_HOUR + 1)
    );
    expect(result).toEqual({ processed: 1, dispatched: 0, suppressed: 1 });
    expect(events[0].dispatched_at).not.toBeNull();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('reports zero, without throwing, when the table is not there yet', async () => {
    const db = {
      from: () => {
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          is: () => b,
          order: () => b,
          limit: () => b,
          then: (onF: (v: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { message: 'relation "deal_stage_events" does not exist' },
            }).then(onF),
        });
        return b;
      },
    } as unknown as SupabaseClient;
    await expect(drainDealStageEvents(100, db)).resolves.toEqual({
      processed: 0,
      dispatched: 0,
      suppressed: 0,
    });
  });
});
