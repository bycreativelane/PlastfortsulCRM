import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Automation } from '@/types';
import { checkReentry } from './reentry';

interface Seen {
  table: string;
  filters: [string, unknown][];
}

/**
 * Answers the two tables `checkReentry` reads with whatever the test
 * says, and records which column each query filtered on — the subject
 * (deal vs contact) is the thing under test as much as the verdict.
 */
function fakeDb(
  answers: { pending?: unknown[]; logs?: unknown[] },
  seen: Seen[]
): SupabaseClient {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const b: Record<string, unknown> = {};
      const resolve = () => {
        seen.push({ table, filters });
        if (table === 'automation_pending_executions') {
          return { data: answers.pending ?? [], error: null };
        }
        if (table === 'automation_logs')
          return { data: answers.logs ?? [], error: null };
        return { data: [], error: null };
      };
      Object.assign(b, {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        neq: (k: string, v: unknown) => (filters.push([`neq:${k}`, v]), b),
        gte: (k: string, v: unknown) => (filters.push([`gte:${k}`, v]), b),
        limit: () => b,
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(resolve()).then(onF, onR),
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    account_id: 'acct',
    user_id: 'u1',
    name: 'x',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: true,
    execution_count: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('checkReentry', () => {
  it('lets a plain contact-level automation run every time — the pre-065 behaviour', async () => {
    const seen: Seen[] = [];
    const verdict = await checkReentry(
      fakeDb({ pending: [{ id: 'p' }] }, seen),
      automation(),
      {
        contactId: 'c1',
        dealId: null,
        dealScoped: false,
      }
    );
    expect(verdict).toBeNull();
    // Not a single query: `always` with no deal asks nothing.
    expect(seen).toEqual([]);
  });

  it('never runs twice at once for the same deal, whatever the policy', async () => {
    const seen: Seen[] = [];
    const verdict = await checkReentry(
      fakeDb({ pending: [{ id: 'p' }] }, seen),
      automation({ reentry_policy: 'always', pipeline_id: 'pipe' }),
      { contactId: 'c1', dealId: 'd1', dealScoped: true }
    );
    expect(verdict).toBe('already_running');
    expect(seen[0].table).toBe('automation_pending_executions');
    expect(seen[0].filters).toContainEqual(['deal_id', 'd1']);
  });

  it('after_complete blocks while a run is parked for the contact', async () => {
    const seen: Seen[] = [];
    const verdict = await checkReentry(
      fakeDb({ pending: [{ id: 'p' }] }, seen),
      automation({ reentry_policy: 'after_complete' }),
      { contactId: 'c1', dealId: null, dealScoped: false }
    );
    expect(verdict).toBe('reentry_blocked');
    expect(seen[0].filters).toContainEqual(['contact_id', 'c1']);
  });

  it('never blocks once a real run exists, but ignores skipped rows', async () => {
    const seen: Seen[] = [];
    const verdict = await checkReentry(
      fakeDb({ logs: [{ id: 'l' }] }, seen),
      automation({ reentry_policy: 'never' }),
      { contactId: 'c1', dealId: null, dealScoped: false }
    );
    expect(verdict).toBe('reentry_blocked');
    const logQuery = seen.find((s) => s.table === 'automation_logs')!;
    expect(logQuery.filters).toContainEqual(['neq:status', 'skipped']);
  });

  it('after_days looks back exactly that window and passes when it is empty', async () => {
    const seen: Seen[] = [];
    const verdict = await checkReentry(
      fakeDb({ logs: [] }, seen),
      automation({ reentry_policy: 'after_days', reentry_days: 7 }),
      { contactId: 'c1', dealId: null, dealScoped: false }
    );
    expect(verdict).toBeNull();
    const logQuery = seen.find((s) => s.table === 'automation_logs')!;
    const since = logQuery.filters.find(
      ([k]) => k === 'gte:created_at'
    )?.[1] as string;
    const ageMs = Date.now() - new Date(since).getTime();
    expect(ageMs).toBeGreaterThan(7 * 86_400_000 - 5_000);
    expect(ageMs).toBeLessThan(7 * 86_400_000 + 5_000);
  });

  it('fails open when the queue query errors — a pre-065 database keeps working', async () => {
    const db = {
      from: () => {
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          eq: () => b,
          limit: () => b,
          then: (onF: (v: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { message: 'column deal_id does not exist' },
            }).then(onF),
        });
        return b;
      },
    } as unknown as SupabaseClient;
    const verdict = await checkReentry(
      db,
      automation({ pipeline_id: 'pipe' }),
      {
        contactId: 'c1',
        dealId: 'd1',
        dealScoped: true,
      }
    );
    expect(verdict).toBeNull();
  });
});
