import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  dispatch: vi.fn(async () => {}),
}));

vi.mock('./engine', () => ({ runAutomationsForTrigger: h.dispatch }));

import { runDateFieldSweeps } from './date-sweep';

interface Seen {
  rpc: { fn: string; args: Record<string, unknown> }[];
  contactQueries: [string, unknown][][];
}

function fakeDb(
  automations: Record<string, unknown>[],
  birthdays: string[],
  dated: string[],
  seen: Seen
): SupabaseClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      seen.rpc.push({ fn, args });
      return { data: birthdays.map((id) => ({ id })), error: null };
    },
    from(table: string) {
      const filters: [string, unknown][] = [];
      const b: Record<string, unknown> = {};
      const resolve = () => {
        if (table === 'automations') return { data: automations, error: null };
        if (table === 'contacts') {
          seen.contactQueries.push(filters);
          return { data: dated.map((id) => ({ id })), error: null };
        }
        return { data: [], error: null };
      };
      Object.assign(b, {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        limit: () => b,
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(resolve()).then(onF, onR),
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

function birthdayAutomation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a-bday',
    account_id: 'acct',
    trigger_type: 'date_field_reached',
    trigger_config: { field: 'birthday', at: '09:00' },
    is_active: true,
    ...overrides,
  };
}

// 2026-09-02 13:00Z = 10:00 in São Paulo; 11:00Z = 08:00.
const AFTER_NINE = new Date('2026-09-02T13:00:00Z');
const BEFORE_NINE = new Date('2026-09-02T11:00:00Z');

beforeEach(() => h.dispatch.mockClear());

describe('runDateFieldSweeps', () => {
  it('asks the database who has a birthday today, in the zone, and dispatches once per contact', async () => {
    const seen: Seen = { rpc: [], contactQueries: [] };
    const result = await runDateFieldSweeps(
      AFTER_NINE,
      fakeDb([birthdayAutomation()], ['c1', 'c2'], [], seen)
    );

    expect(result).toEqual({ automations: 1, dispatched: 2 });
    expect(seen.rpc).toEqual([
      {
        fn: 'contacts_with_birthday_on',
        args: { p_account_id: 'acct', p_month: 9, p_day: 2 },
      },
    ]);
    expect(h.dispatch).toHaveBeenCalledWith({
      accountId: 'acct',
      triggerType: 'date_field_reached',
      contactId: 'c1',
      context: { date_field: 'birthday', trigger_key: 'contact:c1:2026-09-02' },
    });
  });

  it('waits for the configured hour in the configured zone', async () => {
    const seen: Seen = { rpc: [], contactQueries: [] };
    const result = await runDateFieldSweeps(
      BEFORE_NINE,
      fakeDb([birthdayAutomation()], ['c1'], [], seen)
    );
    expect(result.dispatched).toBe(0);
    expect(seen.rpc).toEqual([]);
  });

  it('reads the contacts once for two automations on the same field', async () => {
    const seen: Seen = { rpc: [], contactQueries: [] };
    const result = await runDateFieldSweeps(
      AFTER_NINE,
      fakeDb(
        [birthdayAutomation(), birthdayAutomation({ id: 'a-bday-2' })],
        ['c1'],
        [],
        seen
      )
    );
    expect(result).toEqual({ automations: 2, dispatched: 1 });
    expect(seen.rpc).toHaveLength(1);
    // One dispatch reaches both automations: the engine matches each by field.
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('compares the other date columns by exact day, skipping opted-out contacts', async () => {
    const seen: Seen = { rpc: [], contactQueries: [] };
    await runDateFieldSweeps(
      AFTER_NINE,
      fakeDb(
        [
          birthdayAutomation({
            trigger_config: { field: 'next_purchase_expected_at' },
          }),
        ],
        [],
        ['c9'],
        seen
      )
    );
    expect(seen.contactQueries[0]).toEqual([
      ['account_id', 'acct'],
      ['next_purchase_expected_at', '2026-09-02'],
      ['opted_out', false],
    ]);
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c9',
        context: {
          date_field: 'next_purchase_expected_at',
          trigger_key: 'contact:c9:2026-09-02',
        },
      })
    );
  });

  it('ignores an automation without a field rather than sweeping everything', async () => {
    const seen: Seen = { rpc: [], contactQueries: [] };
    const result = await runDateFieldSweeps(
      AFTER_NINE,
      fakeDb([birthdayAutomation({ trigger_config: {} })], ['c1'], [], seen)
    );
    expect(result.dispatched).toBe(0);
  });
});
