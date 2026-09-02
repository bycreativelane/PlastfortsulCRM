import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  cancelPendingByStep,
  cancelPendingOnReply,
  cancelPendingOnStageEnter,
} from './cancel';

interface Row {
  id: string;
  log_id: string | null;
  automation_id: string;
  status: string;
  account_id: string;
  contact_id: string;
  deal_id: string | null;
  automations: {
    cancel_on_reply?: boolean;
    cancel_when_stage_in?: string[];
  };
}

interface Captured {
  pending: { id: string; payload: Record<string, unknown> }[];
  logs: { id: string; payload: Record<string, unknown> }[];
}

/**
 * The two tables the module touches. Selects filter the rows by the
 * `eq` calls the module makes; updates flip `status` only when the row
 * is still `pending`, which is the race guard under test.
 */
function fakeDb(rows: Row[], captured: Captured): SupabaseClient {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let type: 'select' | 'update' = 'select';
      let payload: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      const resolve = () => {
        if (table === 'automation_pending_executions') {
          if (type === 'select') {
            const data = rows.filter((r) =>
              filters.every(
                ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v
              )
            );
            return { data, error: null };
          }
          const id = filters.find(([k]) => k === 'id')?.[1];
          const row = rows.find((r) => r.id === id);
          if (row && row.status === 'pending') {
            row.status = String(payload.status);
            captured.pending.push({ id: row.id, payload });
            return { data: { id: row.id }, error: null };
          }
          return { data: null, error: null };
        }
        if (table === 'automation_logs' && type === 'update') {
          const id = filters.find(([k]) => k === 'id')?.[1];
          captured.logs.push({ id: String(id), payload });
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };
      Object.assign(b, {
        select: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
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

function row(
  partial: Partial<Row> & { id: string; automation_id: string }
): Row {
  return {
    log_id: `log-${partial.id}`,
    status: 'pending',
    account_id: 'acct',
    contact_id: 'c1',
    deal_id: 'd1',
    automations: {},
    ...partial,
  };
}

describe('cancelPendingOnReply', () => {
  it('cancels only the runs whose automation asked for it, and closes their logs', async () => {
    const rows = [
      row({
        id: 'p1',
        automation_id: 'a1',
        automations: { cancel_on_reply: true },
      }),
      row({
        id: 'p2',
        automation_id: 'a2',
        automations: { cancel_on_reply: false },
      }),
      row({ id: 'p3', automation_id: 'a3', automations: {} }),
    ];
    const captured: Captured = { pending: [], logs: [] };

    const n = await cancelPendingOnReply(fakeDb(rows, captured), {
      accountId: 'acct',
      contactId: 'c1',
    });

    expect(n).toBe(1);
    expect(rows.map((r) => r.status)).toEqual([
      'cancelled',
      'pending',
      'pending',
    ]);
    expect(captured.pending[0].payload).toMatchObject({
      status: 'cancelled',
      cancelled_reason: 'customer_replied',
    });
    expect(captured.logs).toEqual([
      {
        id: 'log-p1',
        payload: {
          status: 'cancelled',
          end_reason: 'customer_replied',
          error_message: null,
        },
      },
    ]);
  });

  it('does not count a row the cron claimed a moment earlier', async () => {
    // Already `running`: the runner owns it and will finish or fail it.
    const rows = [
      row({
        id: 'p1',
        automation_id: 'a1',
        status: 'running',
        automations: { cancel_on_reply: true },
      }),
    ];
    const captured: Captured = { pending: [], logs: [] };
    // The select the module makes filters on status = pending, so the
    // running row is never even offered.
    const n = await cancelPendingOnReply(fakeDb(rows, captured), {
      accountId: 'acct',
      contactId: 'c1',
    });
    expect(n).toBe(0);
    expect(captured.logs).toEqual([]);
  });
});

describe('cancelPendingOnStageEnter', () => {
  it('cancels the runs whose automation lists the stage entered', async () => {
    const rows = [
      row({
        id: 'p1',
        automation_id: 'a1',
        automations: { cancel_when_stage_in: ['s-neg', 's-won'] },
      }),
      row({
        id: 'p2',
        automation_id: 'a2',
        automations: { cancel_when_stage_in: ['s-lost'] },
      }),
      row({ id: 'p3', automation_id: 'a3', automations: {} }),
    ];
    const captured: Captured = { pending: [], logs: [] };

    const n = await cancelPendingOnStageEnter(fakeDb(rows, captured), {
      accountId: 'acct',
      dealId: 'd1',
      stageId: 's-neg',
    });

    expect(n).toBe(1);
    expect(captured.pending[0]).toMatchObject({
      id: 'p1',
      payload: { cancelled_reason: 'stage_entered:s-neg' },
    });
    expect(captured.logs[0].payload.end_reason).toBe('stage_entered:s-neg');
  });
});

describe('cancelPendingByStep', () => {
  it('reaches every other automation of the deal when no list is given', async () => {
    const rows = [
      row({ id: 'p1', automation_id: 'me' }),
      row({ id: 'p2', automation_id: 'other' }),
      row({ id: 'p3', automation_id: 'another', deal_id: 'd2' }),
    ];
    const captured: Captured = { pending: [], logs: [] };

    const n = await cancelPendingByStep(fakeDb(rows, captured), {
      accountId: 'acct',
      scope: 'deal',
      dealId: 'd1',
      contactId: 'c1',
      byAutomationId: 'me',
    });

    expect(n).toBe(1);
    expect(rows.map((r) => r.status)).toEqual([
      'pending',
      'cancelled',
      'pending',
    ]);
    expect(captured.pending[0].payload.cancelled_reason).toBe(
      'cancelled_by:me'
    );
  });

  it('honours an explicit list, including the caller itself, across the contact', async () => {
    const rows = [
      row({ id: 'p1', automation_id: 'me', deal_id: 'd9' }),
      row({ id: 'p2', automation_id: 'other' }),
    ];
    const captured: Captured = { pending: [], logs: [] };

    const n = await cancelPendingByStep(fakeDb(rows, captured), {
      accountId: 'acct',
      scope: 'contact',
      dealId: 'd1',
      contactId: 'c1',
      automationIds: ['me'],
      byAutomationId: 'me',
    });

    expect(n).toBe(1);
    expect(rows[0].status).toBe('cancelled');
    expect(rows[1].status).toBe('pending');
  });

  it('cancels nothing for a deal scope without a deal', async () => {
    const rows = [row({ id: 'p1', automation_id: 'other' })];
    const captured: Captured = { pending: [], logs: [] };
    const n = await cancelPendingByStep(fakeDb(rows, captured), {
      accountId: 'acct',
      scope: 'deal',
      dealId: null,
      contactId: 'c1',
      byAutomationId: 'me',
    });
    expect(n).toBe(0);
    expect(rows[0].status).toBe('pending');
  });
});
