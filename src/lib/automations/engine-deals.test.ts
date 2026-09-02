import { beforeEach, describe, expect, it, vi } from 'vitest';

// The deal-aware half of the engine (migration 065): deal resolution,
// reentry, the trigger key, the new triggers, steps and conditions, and
// the wait-until-date. `engine.test.ts` keeps the pre-065 contract; this
// file proves the additions without touching it.

const h = vi.hoisted(() => ({
  state: {
    contact: null as Record<string, unknown> | null,
    automations: [] as import('@/types').Automation[],
    steps: [] as Record<string, unknown>[],
    deals: [] as Record<string, unknown>[],
    stages: [] as Record<string, unknown>[],
    pipelines: [] as Record<string, unknown>[],
    pendingRows: [] as Record<string, unknown>[],
    logRows: [] as Record<string, unknown>[],
    customerMessages: 0,
    logInsertError: null as { code: string; message: string } | null,
    // Captured writes.
    fromCalls: [] as string[],
    logInserts: [] as Record<string, unknown>[],
    logUpdates: [] as Record<string, unknown>[],
    dealUpdates: [] as {
      payload: Record<string, unknown>;
      filters: [string, unknown][];
    }[],
    pendingInserts: [] as Record<string, unknown>[],
    cancelCalls: [] as Record<string, unknown>[],
  },
}));

vi.mock('./admin-client', () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    single: boolean;
    payload?: unknown;
    filters: [string, unknown][];
  }) {
    const { table, type, filters } = ops;
    const byId = (rows: Record<string, unknown>[]) => {
      const id = filters.find(([k]) => k === 'id')?.[1];
      const list = id ? rows.filter((r) => r.id === id) : rows;
      return ops.single
        ? { data: list[0] ?? null, error: null }
        : { data: list, error: null };
    };
    if (table === 'contacts') return { data: state.contact, error: null };
    if (table === 'automations')
      return { data: state.automations, error: null };
    if (table === 'automation_steps') {
      // Scope: root rows have parent_step_id null; branch rows carry it.
      const parent = filters.find(([k]) => k === 'parent_step_id')?.[1];
      const branch = filters.find(([k]) => k === 'branch')?.[1];
      const isRoot = ops.filters.some(([k]) => k === 'is:parent_step_id');
      const rows = state.steps.filter((s) =>
        isRoot
          ? !s.parent_step_id
          : s.parent_step_id === parent && (s.branch ?? 'yes') === branch
      );
      return { data: rows, error: null };
    }
    if (table === 'automation_logs') {
      if (type === 'insert') {
        if (state.logInsertError)
          return { data: null, error: state.logInsertError };
        state.logInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: 'log1' }, error: null };
      }
      if (type === 'update') {
        state.logUpdates.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (ops.single)
        return { data: { steps_executed: [], status: 'failed' }, error: null };
      return { data: state.logRows, error: null };
    }
    if (table === 'deals') {
      if (type === 'update') {
        state.dealUpdates.push({
          payload: ops.payload as Record<string, unknown>,
          filters,
        });
        return { data: null, error: null };
      }
      return byId(state.deals);
    }
    if (table === 'pipeline_stages') return byId(state.stages);
    if (table === 'pipelines') return byId(state.pipelines);
    if (table === 'automation_pending_executions') {
      if (type === 'insert') {
        state.pendingInserts.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (type === 'update') return { data: { id: 'p' }, error: null };
      return { data: state.pendingRows, error: null };
    }
    if (table === 'messages')
      return { data: null, error: null, count: state.customerMessages };
    if (table === 'conversations')
      return { data: { id: 'conv1' }, error: null };
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: 'select',
      single: false,
      payload: undefined as unknown,
      filters: [] as [string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      delete: () => ((ops.type = 'delete'), b),
      upsert: (p: unknown) => ((ops.type = 'upsert'), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push([k, v]), b),
      neq: () => b,
      gt: () => b,
      gte: () => b,
      lte: () => b,
      is: (k: string) => (ops.filters.push([`is:${k}`, null]), b),
      order: () => b,
      limit: () => b,
      single: () => ((ops.single = true), Promise.resolve(resolve(ops))),
      maybeSingle: () => ((ops.single = true), Promise.resolve(resolve(ops))),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock('./meta-send', () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
}));

vi.mock('./cancel', () => ({
  cancelPendingByStep: vi.fn(
    async (_db: unknown, input: Record<string, unknown>) => {
      h.state.cancelCalls.push(input);
      return 2;
    }
  ),
}));

import { runAutomationsForTrigger, triggerMatches } from './engine';
import type { Automation } from '@/types';

const ACCOUNT = 'acct-1';

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    account_id: ACCOUNT,
    user_id: 'u1',
    name: 'test',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: true,
    execution_count: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function step(
  step_type: string,
  step_config: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `s-${step_type}-${Math.random()}`,
    automation_id: 'a1',
    step_type,
    step_config,
    position: 0,
    parent_step_id: null,
    ...extra,
  };
}

beforeEach(() => {
  const s = h.state;
  s.contact = { id: 'c1' };
  s.automations = [];
  s.steps = [];
  s.deals = [];
  s.stages = [];
  s.pipelines = [{ id: 'p1', account_id: ACCOUNT }];
  s.pendingRows = [];
  s.logRows = [];
  s.customerMessages = 0;
  s.logInsertError = null;
  s.fromCalls = [];
  s.logInserts = [];
  s.logUpdates = [];
  s.dealUpdates = [];
  s.pendingInserts = [];
  s.cancelCalls = [];
});

describe('triggerMatches — the triggers of 065', () => {
  it('deal_stage_entered matches the exact stage and fails closed', () => {
    const a = automation({
      trigger_type: 'deal_stage_entered',
      trigger_config: { stage_id: 's1' },
    });
    expect(triggerMatches(a, { stage_id: 's1' })).toBe(true);
    expect(triggerMatches(a, { stage_id: 's2' })).toBe(false);
    expect(triggerMatches(a, {})).toBe(false);
    expect(
      triggerMatches(
        automation({ trigger_type: 'deal_stage_entered', trigger_config: {} }),
        { stage_id: 's1' }
      )
    ).toBe(false);
  });

  it('team_message_sent matches the quick reply or the template, never everything', () => {
    const byQr = automation({
      trigger_type: 'team_message_sent',
      trigger_config: { quick_reply_id: 'q1' },
    });
    expect(triggerMatches(byQr, { quick_reply_id: 'q1' })).toBe(true);
    expect(triggerMatches(byQr, { quick_reply_id: 'q2' })).toBe(false);
    const byTpl = automation({
      trigger_type: 'team_message_sent',
      trigger_config: { template_name: 'orcamento_enviado' },
    });
    expect(triggerMatches(byTpl, { template_name: 'orcamento_enviado' })).toBe(
      true
    );
    expect(triggerMatches(byTpl, { quick_reply_id: 'q1' })).toBe(false);
    const empty = automation({
      trigger_type: 'team_message_sent',
      trigger_config: {},
    });
    expect(
      triggerMatches(empty, { quick_reply_id: 'q1', template_name: 'x' })
    ).toBe(false);
  });

  it('date_field_reached matches its own field only', () => {
    const a = automation({
      trigger_type: 'date_field_reached',
      trigger_config: { field: 'birthday' },
    });
    expect(triggerMatches(a, { date_field: 'birthday' })).toBe(true);
    expect(triggerMatches(a, { date_field: 'next_purchase_expected_at' })).toBe(
      false
    );
  });
});

describe('deal resolution and the log', () => {
  it("resolves the contact's newest open deal in the declared funnel and writes it on the log", async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's1',
        value: 0,
      },
    ];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    h.state.steps = [step('close_conversation', {})];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.logInserts[0]).toMatchObject({
      deal_id: 'd1',
      status: 'failed',
    });
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: 'success' });
  });

  it('never touches deals for an automation without a funnel — the pre-065 path', async () => {
    h.state.automations = [automation()];
    h.state.steps = [step('close_conversation', {})];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.fromCalls).not.toContain('deals');
    expect(h.state.logInserts[0]).toMatchObject({ deal_id: null });
  });

  it('refuses a second run for the same deal while one is parked, and says so', async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's1',
        value: 0,
      },
    ];
    h.state.pendingRows = [{ id: 'p-old' }];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    h.state.steps = [step('close_conversation', {})];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });

    expect(h.state.logInserts).toHaveLength(1);
    expect(h.state.logInserts[0]).toMatchObject({
      status: 'skipped',
      end_reason: 'already_running',
      deal_id: 'd1',
    });
    expect(h.state.fromCalls).not.toContain('automation_steps');
  });

  it('stops before any step when the trigger key was already used today', async () => {
    h.state.logInsertError = { code: '23505', message: 'duplicate key' };
    h.state.automations = [
      automation({
        trigger_type: 'date_field_reached',
        trigger_config: { field: 'birthday' },
      }),
    ];
    h.state.steps = [step('close_conversation', {})];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'date_field_reached',
      contactId: 'c1',
      context: { date_field: 'birthday', trigger_key: 'contact:c1:2026-09-02' },
    });

    expect(h.state.fromCalls).not.toContain('automation_steps');
  });

  it('retries the log insert without the 065 columns on an older database', async () => {
    h.state.logInsertError = {
      code: 'PGRST204',
      message: "Could not find the 'deal_id' column",
    };
    h.state.automations = [automation()];
    h.state.steps = [step('close_conversation', {})];
    // First insert fails; the retry must succeed — flip the error off on
    // the first call by clearing it from inside the mock's payload hook.
    const original = h.state.logInsertError;
    let calls = 0;
    h.state.logInsertError = new Proxy(original, {
      get(target, prop) {
        calls++;
        if (calls > 2) return undefined;
        return (target as Record<string, unknown>)[prop as string];
      },
    }) as typeof original;
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(
      h.state.fromCalls.filter((t) => t === 'automation_logs').length
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('move_deal_stage', () => {
  beforeEach(() => {
    h.state.stages = [
      { id: 's-neg', name: 'Em Negociação', pipeline_id: 'p1' },
      { id: 's-won', name: 'Em Andamento', pipeline_id: 'p1' },
      { id: 's-lost', name: 'Venda Perdida', pipeline_id: 'p1' },
    ];
  });

  it('moves the run deal and leaves status alone for an ordinary stage', async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's-open',
        value: 0,
      },
    ];
    h.state.automations = [
      automation({
        trigger_type: 'deal_stage_entered',
        trigger_config: { stage_id: 's-open' },
      }),
    ];
    h.state.steps = [step('move_deal_stage', { stage_id: 's-neg' })];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'deal_stage_entered',
      contactId: 'c1',
      context: { deal_id: 'd1', stage_id: 's-open' },
    });

    expect(h.state.dealUpdates).toHaveLength(1);
    expect(h.state.dealUpdates[0].payload).toMatchObject({ stage_id: 's-neg' });
    expect(h.state.dealUpdates[0].payload).not.toHaveProperty('status');
    expect(h.state.dealUpdates[0].filters).toContainEqual([
      'account_id',
      ACCOUNT,
    ]);
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: 'success' });
  });

  it('marks a won stage won only when the deal carries a value', async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's-neg',
        value: 0,
      },
    ];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    h.state.steps = [step('move_deal_stage', { stage_id: 's-won' })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.dealUpdates[0].payload).not.toHaveProperty('status');
    const detail = (
      h.state.logUpdates.at(-1)?.steps_executed as { detail: string }[]
    )[0].detail;
    expect(detail).toMatch(/status left open/);

    h.state.dealUpdates = [];
    h.state.deals[0].value = 1500;
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.dealUpdates[0].payload).toMatchObject({
      stage_id: 's-won',
      status: 'won',
    });
  });

  it('refuses a lost stage without a reason — the same gate the board has', async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's-neg',
        value: 0,
      },
    ];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    h.state.steps = [step('move_deal_stage', { stage_id: 's-lost' })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.dealUpdates).toHaveLength(0);
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: 'failed' });
    expect(String(h.state.logUpdates.at(-1)?.error_message)).toMatch(
      /lost_reason/
    );

    h.state.logUpdates = [];
    h.state.steps = [
      step('move_deal_stage', { stage_id: 's-lost', lost_reason: 'price' }),
    ];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.dealUpdates[0].payload).toMatchObject({
      status: 'lost',
      lost_reason: 'price',
    });
  });

  it('fails clearly when the contact has no open deal', async () => {
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    h.state.steps = [step('move_deal_stage', { stage_id: 's-neg' })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: 'failed' });
    expect(String(h.state.logUpdates.at(-1)?.error_message)).toMatch(
      /no open deal/
    );
  });
});

describe('end, cancel_automations and the deal conditions', () => {
  it('end closes the run as a success with the reason, even inside a branch', async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's-open',
        value: 0,
      },
    ];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    const cond = step('condition', { subject: 'deal_is_open' });
    h.state.steps = [
      cond,
      step(
        'end',
        { reason: 'still_open' },
        { parent_step_id: cond.id, branch: 'yes' }
      ),
      step('close_conversation', {}, { position: 1 }),
    ];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.logUpdates).toContainEqual(
      expect.objectContaining({ end_reason: 'still_open' })
    );
    // The root step after the condition never ran.
    expect(h.state.fromCalls).not.toContain('conversations');
  });

  it('cancel_automations reaches the module with the deal scope of the run', async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's-open',
        value: 0,
      },
    ];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    h.state.steps = [step('cancel_automations', { scope: 'deal' })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.cancelCalls[0]).toMatchObject({
      accountId: ACCOUNT,
      scope: 'deal',
      dealId: 'd1',
      contactId: 'c1',
      byAutomationId: 'a1',
    });
  });

  it('deal_in_stage and customer_replied_since read the deal and the thread', async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's-fu',
        value: 0,
        stage_entered_at: '2026-09-01T00:00:00Z',
      },
    ];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    const inStage = step('condition', {
      subject: 'deal_in_stage',
      stage_ids: ['s-fu', 's-f30'],
    });
    h.state.steps = [inStage];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(
      (h.state.logUpdates.at(-1)?.steps_executed as { detail: string }[])[0]
        .detail
    ).toBe('branch=yes');

    h.state.logUpdates = [];
    h.state.customerMessages = 0;
    h.state.steps = [
      step('condition', {
        subject: 'customer_replied_since',
        operand: 'stage_entry',
      }),
    ];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(
      (h.state.logUpdates.at(-1)?.steps_executed as { detail: string }[])[0]
        .detail
    ).toBe('branch=no');

    h.state.logUpdates = [];
    h.state.customerMessages = 1;
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(
      (h.state.logUpdates.at(-1)?.steps_executed as { detail: string }[])[0]
        .detail
    ).toBe('branch=yes');
  });
});

describe('template variables', () => {
  it('fills {{contact.first_name}} and {{deal.title}} from the run, once', async () => {
    h.state.contact = { id: 'c1', name: 'Marcos Antônio Silva' };
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's-fu',
        value: 0,
        title: 'sacos de lixo 100L',
      },
    ];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    h.state.steps = [
      step('send_template', {
        template_name: 'followup_d1',
        language: 'pt_BR',
        variables: { '1': '{{contact.first_name}}', '2': '{{deal.title}}' },
      }),
    ];
    const { engineSendTemplate } = await import('./meta-send');
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    const call = (
      engineSendTemplate as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)![0] as { params: string[] };
    expect(call.params).toEqual(['Marcos', 'sacos de lixo 100L']);
  });

  it('greets a nameless contact as "cliente" rather than sending an empty parameter', async () => {
    h.state.contact = { id: 'c1', name: null };
    h.state.automations = [automation()];
    h.state.steps = [
      step('send_message', { text: 'Olá {{contact.first_name}}!' }),
    ];
    const { engineSendText } = await import('./meta-send');
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    const call = (
      engineSendText as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)![0] as { text: string };
    expect(call.text).toBe('Olá cliente!');
  });
});

describe('wait', () => {
  it('parks with the deal on the row', async () => {
    h.state.deals = [
      {
        id: 'd1',
        account_id: ACCOUNT,
        contact_id: 'c1',
        status: 'open',
        pipeline_id: 'p1',
        stage_id: 's-open',
        value: 0,
      },
    ];
    h.state.automations = [automation({ pipeline_id: 'p1' })];
    h.state.steps = [step('wait', { amount: 1, unit: 'days' })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.pendingInserts[0]).toMatchObject({
      deal_id: 'd1',
      status: 'pending',
    });
    expect(h.state.logUpdates.at(-1)).toMatchObject({ status: 'partial' });
  });

  it('until a contact date parks at that date, in the zone, and remembers why', async () => {
    h.state.contact = { id: 'c1', next_purchase_expected_at: '2030-05-20' };
    h.state.automations = [automation()];
    h.state.steps = [
      step('wait', {
        amount: 1,
        unit: 'days',
        mode: 'until_contact_date',
        field: 'next_purchase_expected_at',
        at: '09:00',
      }),
    ];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.pendingInserts[0].run_at).toBe('2030-05-20T12:00:00.000Z');
    expect(
      (h.state.pendingInserts[0].context as { _wait_until: unknown })
        ._wait_until
    ).toEqual({
      field: 'next_purchase_expected_at',
      at: '09:00',
      timezone: 'America/Sao_Paulo',
    });
  });

  it('until a contact date ends the run quietly when the date is empty', async () => {
    h.state.contact = { id: 'c1', next_purchase_expected_at: null };
    h.state.automations = [automation()];
    h.state.steps = [
      step('wait', {
        amount: 1,
        unit: 'days',
        mode: 'until_contact_date',
        field: 'next_purchase_expected_at',
      }),
    ];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: {},
    });
    expect(h.state.pendingInserts).toHaveLength(0);
    expect(h.state.logUpdates).toContainEqual(
      expect.objectContaining({ end_reason: 'date_cleared' })
    );
  });
});
