import type {
  Automation,
  AutomationLogStatus,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  CancelAutomationsStepConfig,
  ConditionStepConfig,
  DateFieldReachedTriggerConfig,
  DealStageEnteredTriggerConfig,
  EndStepConfig,
  KeywordMatchTriggerConfig,
  InteractiveReplyTriggerConfig,
  MoveDealStageStepConfig,
  TagTriggerConfig,
  TeamMessageSentTriggerConfig,
  SendMessageStepConfig,
  SendButtonsStepConfig,
  SendListStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  UpdateDealStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  AssignConversationStepConfig,
} from '@/types';
import { supabaseAdmin } from './admin-client';
import { stepNeedsMessagesScope } from '@/lib/hooks/inbound';
import { addContactTagIfAbsent } from '@/lib/contacts/tag-write';
import {
  MAX_TAG_CHAIN_DEPTH,
  getTagChainDepth,
} from '@/lib/contacts/tag-chain';
import {
  engineSendText,
  engineSendTemplate,
  engineSendInteractive,
} from './meta-send';
import { validateInteractivePayload } from '@/lib/whatsapp/interactive';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import { autoAssignConversation } from '@/lib/conversations/auto-assign';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import { isLostStage, isWonStage } from '@/lib/deals/outcome';
import { cancelPendingByStep } from './cancel';
import { checkReentry } from './reentry';
import {
  DEFAULT_TIMEZONE,
  parseHHmm,
  safeTimeZone,
  zonedTimeToUtc,
} from './local-time';

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string;
  /** Conversation the event belongs to, if any. */
  conversation_id?: string;
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>;
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string;
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string;
  /** Button / list-row id the customer tapped, for interactive_reply. */
  interactive_reply_id?: string;
  /**
   * What the INBOUND HOOK that fired this run is allowed to do.
   *
   * Present only when the trigger came from `/api/hooks/<token>`;
   * `undefined` means the run started from something already inside the
   * product (a customer message, a tag, the scheduler) and no extra
   * limit applies.
   *
   * See `runStep`: a hook without `messages` cannot make the account's
   * WhatsApp number send anything. That is the difference between a
   * leaked token — or an n8n loop — being data pollution and being a
   * ban from Meta.
   */
  hook_scopes?: string[];
  /** Which hook, for the log line when a step is refused. */
  hook_name?: string;
  /**
   * The `webhook_deliveries` row that caused this run.
   *
   * Written onto every `automation_logs` row the dispatch creates, so
   * the deliveries screen can answer "and then what happened" without
   * matching on timestamps — which breaks the moment two deliveries
   * land in the same second.
   */
  delivery_id?: string;

  /* ---- The deal (migration 065) ---------------------------------------
   * A run works at most one deal. It arrives with the stage trigger, or
   * is resolved from the contact — the newest open deal in the funnel
   * the automation declared — and travels with the run: onto the parked
   * row, onto the log, into every step that needs it. */
  deal_id?: string;
  /** For deal_stage_entered: the stage the deal just entered. */
  stage_id?: string;
  from_stage_id?: string;
  stage_event_id?: string;

  /* ---- team_message_sent --------------------------------------------- */
  /** The quick reply the agent used, by id, and its shortcut. */
  quick_reply_id?: string;
  shortcut?: string;
  /** The template the agent sent, by name. */
  template_name?: string;
  /** Our `messages.id` of the sent message. */
  message_id?: string;

  /* ---- date_field_reached -------------------------------------------- */
  /** Which contact date is today. */
  date_field?: string;
  /**
   * Idempotency key for sweeps — `contact:<id>:<YYYY-MM-DD>`. Written to
   * `automation_logs.trigger_key`; the unique index there refuses a second
   * run of the same automation for the same key.
   */
  trigger_key?: string;

  /** When this run started (ISO). Set by the engine; read by
   *  `customer_replied_since: run_start`. */
  run_started_at?: string;

  /**
   * Internal: a `wait` in `until_contact_date` mode parks with this so
   * the resume can re-read the date and re-park if it moved.
   */
  _wait_until?: {
    field: string;
    at: string;
    timezone: string;
  };
}

export interface DispatchInput {
  /** Account-level tenancy key. Drives the lookup of which active
   *  automations to fire — `automations.account_id` is the tenant
   *  isolation after migration 017. Replaces the previous `userId`
   *  field; the per-automation user_id is read off each row when
   *  needed (sender identity for outbound messages, log audit). */
  accountId: string;
  triggerType: AutomationTriggerType;
  contactId?: string | null;
  context?: AutomationContext;
}

/**
 * Fire all active automations matching the given trigger for an
 * account.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(
  input: DispatchInput
): Promise<void> {
  try {
    const db = supabaseAdmin();

    // Tenant isolation. `contactId` can be caller-supplied (the manual
    // POST /api/automations/engine entrypoint reads it straight from the
    // request body), and every step below runs through the service-role
    // client, which bypasses RLS. So before any step can touch the
    // contact, verify it actually belongs to this account. A foreign or
    // forged id is refused silently — callers are fire-and-forget, and a
    // distinct error would leak whether a given contact UUID exists.
    if (input.contactId) {
      const { data: owned, error: ownErr } = await db
        .from('contacts')
        .select('id')
        .eq('id', input.contactId)
        .eq('account_id', input.accountId)
        .maybeSingle();
      if (ownErr) {
        console.error('[automations] contact ownership check failed:', ownErr);
        return;
      }
      if (!owned) {
        console.warn(
          '[automations] contact not in account, refusing dispatch',
          input.contactId
        );
        return;
      }
    }

    const { data: automations, error } = await db
      .from('automations')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('trigger_type', input.triggerType)
      .eq('is_active', true);

    if (error) {
      console.error('[automations] fetch failed:', error);
      return;
    }
    if (!automations || automations.length === 0) return;

    for (const automation of automations as Automation[]) {
      if (!triggerMatches(automation, input.context)) continue;
      try {
        await executeAutomation(automation, input);
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err);
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err);
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string;
  automation_id: string;
  /** Audit-only; the automation row carries account_id for tenancy. */
  user_id: string;
  /** Account-scoped lookups read from the automation row, so this
   *  field is just here to mirror the row shape and keep the cron's
   *  pass-through self-documenting. */
  account_id: string;
  contact_id: string | null;
  log_id: string | null;
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  next_step_position: number;
  context: AutomationContext;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('id', pending.automation_id)
    .single();

  if (error || !automation) {
    console.error(
      '[automations] resume: missing automation',
      pending.automation_id,
      error
    );
    await markPending(pending.id, 'failed');
    return;
  }

  try {
    const context: AutomationContext = { ...(pending.context ?? {}) };

    // A wait-until-date re-reads the field on waking. The date may have
    // been moved from the agenda (park again), or cleared (the customer
    // is no longer expected — end quietly). Only when it still says
    // "now" does the run go on. This is what makes the wait immune to a
    // reschedule made while it slept.
    if (context._wait_until) {
      const until = context._wait_until;
      delete context._wait_until;
      const target = await contactDateWake(
        automation as Automation,
        pending.contact_id,
        until
      );
      if (target === null) {
        await setEndReason(pending.log_id, 'date_cleared', 'success');
        await markPending(pending.id, 'done');
        return;
      }
      if (target.getTime() > Date.now() + 60_000) {
        await insertPending({
          automation: automation as Automation,
          contactId: pending.contact_id,
          dealId: context.deal_id ?? null,
          logId: pending.log_id,
          parentStepId: pending.parent_step_id,
          branch: pending.branch,
          nextStepPosition: pending.next_step_position,
          context: { ...context, _wait_until: until },
          runAt: target,
        });
        await markPending(pending.id, 'done');
        return;
      }
    }

    await executeStepsFrom({
      automation: automation as Automation,
      contactId: pending.contact_id,
      context,
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
    });
    await markPending(pending.id, 'done');
  } catch (err) {
    console.error('[automations] resume failed:', err);
    await markPending(pending.id, 'failed');
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

/** Triggers whose event IS a deal — the run is deal-scoped by nature. */
const DEAL_TRIGGERS: ReadonlySet<string> = new Set(['deal_stage_entered']);

async function executeAutomation(automation: Automation, input: DispatchInput) {
  const db = supabaseAdmin();
  const contactId = input.contactId ?? null;
  const context: AutomationContext = {
    ...(input.context ?? {}),
    run_started_at: new Date().toISOString(),
  };

  // The deal, resolved up front only when the automation is deal-aware:
  // its trigger carried one, or it declared a funnel. A welcome automation
  // with neither never touches `deals` and behaves exactly as before 065;
  // a step that needs a deal on such an automation resolves lazily via
  // `resolveDealId` and fails with a clear message when there is none.
  const dealScoped =
    DEAL_TRIGGERS.has(automation.trigger_type) || !!automation.pipeline_id;
  let dealId: string | null = null;
  if (dealScoped) {
    dealId = await resolveDealUpFront(automation, contactId, context);
    if (dealId) context.deal_id = dealId;
  }

  // §23 of the official flow: never two runs at once for the same deal,
  // and the automation's own reentry policy. A refusal is written down as
  // a `skipped` log rather than vanishing, so "why did the customer not
  // get the D1 again" has an answer.
  const blocked = await checkReentry(db, automation, {
    contactId,
    dealId,
    dealScoped,
  });
  if (blocked) {
    await insertLog(automation, contactId, dealId, input, {
      status: 'skipped',
      end_reason: blocked,
    });
    return;
  }

  const logId = await insertLog(automation, contactId, dealId, input, {
    // Seeded pessimistically. The row is written BEFORE any step runs,
    // and every terminal path below overwrites it (`appendResults` at
    // the outermost scope, or `finalizeLog`). Seeding 'success' meant a
    // run that died mid-flight — the process frozen, the pod recycled —
    // left a permanent `status: 'success'` with `steps_executed: []`,
    // indistinguishable from an automation that genuinely had nothing
    // to do. 'failed' inverts that: the status only becomes success if
    // execution actually reached the end. See issue #409.
    status: 'failed',
  });
  // A duplicate `trigger_key` — the sweep already fired this automation
  // for this contact today — returns null here and the run stops before
  // a single step. That is the whole point of the key.
  if (!logId) return;

  await executeStepsFrom({
    automation,
    contactId,
    context,
    parentStepId: null,
    branch: null,
    startPosition: 0,
    logId,
    triggerEvent: input.triggerType,
  });

  // Atomic counter update via the SQL function from migration 007.
  // Doing this with a client-side read-modify-write raced when the
  // same automation fired for two contacts simultaneously — both
  // would read N and both write N+1, losing one count permanently.
  const { error: rpcErr } = await db.rpc(
    'increment_automation_execution_count',
    {
      p_automation_id: automation.id,
    }
  );
  if (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr);
  }
}

/**
 * Write the run's log row. Returns its id, or null when the row could not
 * be written — including the deliberate case of a duplicate trigger key.
 *
 * Tolerates a database that has not run migration 065: the columns it
 * added are dropped from the insert and the row is written as before, so
 * deploying the code a day before the migration does not silence every
 * automation for that day.
 */
async function insertLog(
  automation: Automation,
  contactId: string | null,
  dealId: string | null,
  input: DispatchInput,
  extra: { status: AutomationLogStatus; end_reason?: string }
): Promise<string | null> {
  const db = supabaseAdmin();
  const base: Record<string, unknown> = {
    automation_id: automation.id,
    // Tenancy: matches automation.account_id (NOT NULL post-017).
    account_id: automation.account_id,
    // Audit: keeps the historical "author of this automation"
    // pointer so logs still attribute to the right user even
    // after teammates join the account.
    user_id: automation.user_id,
    contact_id: contactId,
    trigger_event: input.triggerType,
    // Null for everything that started inside the product. See 059.
    delivery_id: input.context?.delivery_id ?? null,
    steps_executed: [],
    status: extra.status,
  };
  const withNew: Record<string, unknown> = {
    ...base,
    deal_id: dealId,
    trigger_key: input.context?.trigger_key ?? null,
    end_reason: extra.end_reason ?? null,
  };

  const attempt = async (payload: Record<string, unknown>) =>
    db.from('automation_logs').insert(payload).select().single();

  let { data, error } = await attempt(withNew);
  if (error && isUnknownColumn(error)) {
    ({ data, error } = await attempt(base));
  }
  if (error) {
    if (error.code === '23505') {
      // Unique (automation_id, trigger_key): already fired for this key.
      return null;
    }
    console.error('[automations] cannot create log:', error);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

interface ExecuteArgs {
  automation: Automation;
  contactId: string | null;
  context: AutomationContext;
  parentStepId: string | null;
  branch: 'yes' | 'no' | null;
  startPosition: number;
  logId: string | null;
  triggerEvent: string;
}

/**
 * How a scope finished. `ended` is the one that matters to the caller: an
 * `end` step inside a branch has to stop the steps after the condition
 * too, or "Encerrar" would mean "skip the rest of this column".
 *
 * `waiting` is reported but NOT propagated, on purpose: a wait inside a
 * branch has always let the steps after the condition run immediately,
 * and automations exist that were built on that. The official flow keeps
 * its waits at the root, where a wait stops the run as expected.
 */
type ScopeOutcome = 'done' | 'ended' | 'waiting';

async function executeStepsFrom(args: ExecuteArgs): Promise<ScopeOutcome> {
  const db = supabaseAdmin();

  const baseQuery = db
    .from('automation_steps')
    .select('*')
    .eq('automation_id', args.automation.id)
    .gte('position', args.startPosition)
    .order('position', { ascending: true });

  const scoped =
    args.parentStepId === null
      ? baseQuery.is('parent_step_id', null)
      : baseQuery
          .eq('parent_step_id', args.parentStepId)
          .eq('branch', args.branch ?? 'yes');

  const { data: steps, error: stepsErr } = await scoped;

  if (stepsErr) {
    await finalizeLog(args.logId, 'failed', stepsErr.message);
    return 'done';
  }
  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null);
    }
    return 'done';
  }

  const results: AutomationLogStepResult[] = [];
  let status: 'success' | 'partial' | 'failed' = 'success';
  let errorMessage: string | null = null;

  for (const step of steps as AutomationStep[]) {
    // `wait` is the suspension point: enqueue and stop processing this
    // scope. The cron endpoint will pick it up later.
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig;
      let runAt: Date;
      let detail: string;
      let waitUntil: AutomationContext['_wait_until'];

      if (cfg.mode === 'until_contact_date') {
        const until = {
          field: cfg.field ?? 'next_purchase_expected_at',
          at: cfg.at ?? '09:00',
          timezone: safeTimeZone(cfg.timezone ?? DEFAULT_TIMEZONE),
        };
        const target = await contactDateWake(
          args.automation,
          args.contactId,
          until
        );
        if (target === null) {
          // No date on the record: there is nothing to wait for, and
          // inventing one would message somebody on a day nobody chose.
          results.push({
            step_id: step.id,
            step_type: step.step_type,
            status: 'skipped',
            detail: `no date in ${until.field}; run ended`,
          });
          await appendResults(args.logId, results, 'success', errorMessage);
          await setEndReason(args.logId, 'date_cleared');
          return 'ended';
        }
        runAt =
          target.getTime() > Date.now() ? target : new Date(Date.now() + 1_000);
        detail = `waiting until ${until.field} (${runAt.toISOString()})`;
        waitUntil = until;
      } else {
        runAt = new Date(Date.now() + waitMs(cfg));
        detail = `waiting ${cfg.amount} ${cfg.unit}`;
      }

      await insertPending({
        automation: args.automation,
        contactId: args.contactId,
        dealId: args.context.deal_id ?? null,
        logId: args.logId,
        parentStepId: args.parentStepId,
        branch: args.branch,
        nextStepPosition: step.position + 1,
        context: waitUntil
          ? { ...args.context, _wait_until: waitUntil }
          : args.context,
        runAt,
      });
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      });
      status = 'partial';
      await appendResults(args.logId, results, status, errorMessage);
      return 'waiting';
    }

    // `end` stops the run here — in a branch too. The log closes as a
    // success with the reason, because ending on purpose is not failing.
    if (step.step_type === 'end') {
      const cfg = step.step_config as EndStepConfig;
      const reason = (cfg.reason ?? '').trim() || 'end_step';
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `ended: ${reason}`,
      });
      await appendResults(args.logId, results, 'success', errorMessage);
      await setEndReason(args.logId, reason);
      return 'ended';
    }

    try {
      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig;
        const taken = await evaluateCondition(cfg, args);
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        });
        // Recurse into the chosen branch at position 0 (children use their
        // own ordering within the branch scope).
        const outcome = await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
        });
        if (outcome === 'ended') {
          // The branch already closed the log with its own results; this
          // scope only has to record what it did before the condition.
          await appendResults(args.logId, results, null, errorMessage);
          return 'ended';
        }
        continue;
      }

      const detail = await runStep(step, args);
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail: msg,
      });
      status = 'failed';
      errorMessage = msg;
      break;
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage);
  } else {
    // Nested branch — just append results; parent scope decides final status.
    await appendResults(args.logId, results, null, errorMessage);
  }
  return 'done';
}

async function runStep(
  step: AutomationStep,
  args: ExecuteArgs
): Promise<string> {
  const db = supabaseAdmin();

  /**
   * THE SCOPE GATE, and it lives HERE rather than in the route on
   * purpose.
   *
   * The route knows which hook called; only this function knows which
   * step is about to run. Checking at the door would mean the door
   * predicting every automation an admin might ever wire to the trigger
   * — and being wrong the first time somebody adds a step.
   *
   * Refused rather than thrown: a run whose third step is out of scope
   * should still have done the first two, and the log should say what
   * was skipped and why. A throw would roll the whole thing into
   * "failed" and hide the reason.
   */
  if (
    args.context.hook_scopes &&
    stepNeedsMessagesScope(step.step_type) &&
    !args.context.hook_scopes.includes('messages')
  ) {
    return `skipped: hook "${args.context.hook_name ?? '?'}" is not allowed to send messages`;
  }

  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig;
      if (!args.contactId) throw new Error('send_message needs a contact');
      const text = await interpolate(cfg.text, args);
      if (!text.trim()) throw new Error('send_message has empty text');
      const conversationId = await resolveConversationId(args);
      const { whatsapp_message_id } = await engineSendText({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
      });
      return `sent via Meta (${whatsapp_message_id})`;
    }

    case 'send_buttons':
    case 'send_list': {
      const payload = step.step_config as
        SendButtonsStepConfig | SendListStepConfig;
      if (!args.contactId) throw new Error(`${step.step_type} needs a contact`);
      // Validate against Meta's limits before the network call so a bad
      // payload surfaces as a clear failed-step detail rather than a raw
      // Meta 400 mid-conversation.
      const check = validateInteractivePayload(payload);
      if (!check.ok) throw new Error(check.error);
      const conversationId = await resolveConversationId(args);
      const { whatsapp_message_id } = await engineSendInteractive({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        payload,
      });
      return `interactive sent via Meta (${whatsapp_message_id})`;
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig;
      if (!args.contactId) throw new Error('send_template needs a contact');
      if (!cfg.template_name)
        throw new Error('send_template needs template_name');
      const conversationId = await resolveConversationId(args);
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const params = cfg.variables
        ? await Promise.all(
            Object.keys(cfg.variables)
              .sort((a, b) => {
                const na = Number(a);
                const nb = Number(b);
                const aNum = Number.isFinite(na);
                const bNum = Number.isFinite(nb);
                if (aNum && bNum) return na - nb;
                if (aNum) return -1;
                if (bNum) return 1;
                return a.localeCompare(b);
              })
              .map((k) => interpolate(String(cfg.variables![k]), args))
          )
        : [];
      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      });
      return `template sent via Meta (${whatsapp_message_id})`;
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig;
      if (!args.contactId || !cfg.tag_id)
        throw new Error('add_tag needs contact + tag_id');
      const added = await addContactTagIfAbsent(db, {
        accountId: args.automation.account_id,
        contactId: args.contactId,
        tagId: cfg.tag_id,
      });
      if (!added) return `tag ${cfg.tag_id} already present`;

      const depth = getTagChainDepth(args.context);
      if (depth >= MAX_TAG_CHAIN_DEPTH) {
        console.warn('[automations] tag_added chain depth limit reached', {
          automationId: args.automation.id,
          contactId: args.contactId,
          tagId: cfg.tag_id,
          depth,
        });
        return `tag ${cfg.tag_id} added; tag_added dispatch skipped at depth ${depth}`;
      }

      await runAutomationsForTrigger({
        accountId: args.automation.account_id,
        triggerType: 'tag_added',
        contactId: args.contactId,
        context: {
          ...args.context,
          tag_id: cfg.tag_id,
          vars: {
            ...(args.context.vars ?? {}),
            _tag_chain_depth: depth + 1,
          },
        },
      });
      return `tag ${cfg.tag_id} added and tag_added dispatched`;
    }

    case 'remove_tag': {
      // See add_tag: tenant scoping relies on the runAutomationsForTrigger
      // ownership guard, since contact_tags carries no account_id.
      const cfg = step.step_config as TagStepConfig;
      if (!args.contactId || !cfg.tag_id)
        throw new Error('remove_tag needs contact + tag_id');
      await db
        .from('contact_tags')
        .delete()
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.tag_id);
      return `tag ${cfg.tag_id} removed`;
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig;
      if (!args.contactId)
        throw new Error('assign_conversation needs a contact');
      if (cfg.mode === 'round_robin') {
        // A REAL rotation now. This used to read `profiles ... limit(1)`,
        // which handed every conversation to whichever row came back first
        // — the same person, forever. `autoAssignConversation` keeps the
        // cursor on the account and skips members who are offline; see
        // `@/lib/conversations/auto-assign`.
        const { data: conversations } = await db
          .from('conversations')
          .select('id, assigned_agent_id')
          .eq('account_id', args.automation.account_id)
          .eq('contact_id', args.contactId)
          .limit(1);
        const conversation = conversations?.[0];
        if (!conversation) return 'no conversation for contact';

        const result = await autoAssignConversation(db, {
          accountId: args.automation.account_id,
          conversationId: conversation.id,
          currentAssignee: conversation.assigned_agent_id,
        });
        return result.assignedTo
          ? `assigned to ${result.assignedTo}`
          : `not assigned (${result.reason})`;
      }

      const agentId = cfg.agent_id;
      if (!agentId) return 'no agent resolved';
      await db
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId);
      return `assigned to ${agentId}`;
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig;
      if (!args.contactId)
        throw new Error('update_contact_field needs a contact');
      // Resolve workflow variables ({{ vars.* }}, {{ message.text }}) so custom
      // values can be populated dynamically from the triggering context.
      const value = await interpolate(cfg.value, args);

      // Custom fields are encoded as `custom:<custom_field_id>`; anything else
      // is a built-in contact column.
      if (cfg.field.startsWith('custom:')) {
        const customFieldId = cfg.field.slice('custom:'.length);
        if (!customFieldId) {
          return `field ${cfg.field} not writable from automations`;
        }
        // Defense in depth: the service-role client bypasses RLS, so confirm
        // the field definition belongs to this account before writing.
        const { data: field } = await db
          .from('custom_fields')
          .select('id')
          .eq('id', customFieldId)
          .eq('account_id', args.automation.account_id)
          .maybeSingle();
        if (!field) {
          return `field ${cfg.field} not writable from automations`;
        }
        // Upsert on the table's UNIQUE(contact_id, custom_field_id) so repeated
        // runs overwrite rather than duplicate. Tenancy is enforced above and,
        // for the contact side, by the entry-point ownership guard.
        await db.from('contact_custom_values').upsert(
          {
            contact_id: args.contactId,
            custom_field_id: customFieldId,
            value,
          },
          { onConflict: 'contact_id,custom_field_id' }
        );
        return `custom field updated`;
      }

      const allowed = new Set(['name', 'email', 'company']);
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`;
      }
      // Defense in depth: scope the service-role write to the account so
      // a future caller that skips the entry-point ownership guard still
      // cannot write across tenants.
      await db
        .from('contacts')
        .update({ [cfg.field]: value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id);
      return `${cfg.field} updated`;
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig;
      if (!cfg.pipeline_id || !cfg.stage_id)
        throw new Error('create_deal needs pipeline + stage');
      // Match the account's configured default currency rather than
      // the static `deals.currency` DB default — keeps automation-
      // created deals consistent with the one-currency-per-account
      // rule (issue #218). Fall back to USD if the row is somehow
      // missing the value (pre-021 forks).
      const { data: acct } = await db
        .from('accounts')
        .select('default_currency')
        .eq('id', args.automation.account_id)
        .maybeSingle();
      const { data: created } = await db
        .from('deals')
        .insert({
          // Tenancy + audit, same split as automation_logs above.
          account_id: args.automation.account_id,
          user_id: args.automation.user_id,
          pipeline_id: cfg.pipeline_id,
          stage_id: cfg.stage_id,
          contact_id: args.contactId,
          title: await interpolate(cfg.title, args),
          value: cfg.value ?? 0,
          currency: acct?.default_currency ?? 'USD',
          status: 'open',
        })
        .select('id')
        .maybeSingle();
      // The deal this run just opened becomes the run's deal, so a
      // `move_deal_stage` two steps later knows which one.
      if (created?.id && !args.context.deal_id) {
        args.context.deal_id = created.id as string;
        await setLogDeal(args.logId, created.id as string);
      }
      return 'deal created';
    }

    case 'move_deal_stage': {
      const cfg = step.step_config as MoveDealStageStepConfig;
      if (!cfg.stage_id) throw new Error('move_deal_stage needs stage_id');
      const dealId = await resolveDealId(args);
      const deal = await loadDeal(args, dealId);
      if (!deal) throw new Error('move_deal_stage: deal not found');

      // The target stage must belong to one of this account's pipelines.
      // Two lookups rather than an embedded join: the service-role client
      // bypasses RLS, so the account check has to be explicit.
      const { data: stage } = await db
        .from('pipeline_stages')
        .select('id, name, pipeline_id')
        .eq('id', cfg.stage_id)
        .maybeSingle();
      if (!stage) throw new Error('move_deal_stage: stage not found');
      const { data: pipeline } = await db
        .from('pipelines')
        .select('id')
        .eq('id', stage.pipeline_id as string)
        .eq('account_id', args.automation.account_id)
        .maybeSingle();
      if (!pipeline)
        throw new Error('move_deal_stage: stage not in this account');

      if (deal.stage_id === cfg.stage_id) {
        return `deal already in ${stage.name}`;
      }

      // The same gates the board enforces. A lost stage needs its reason —
      // the report is the reason the question exists. A won stage needs a
      // value; when the record has none the deal still moves (the sale
      // happened) but stays `open` rather than being counted as a sale of
      // zero, and the log says so.
      const update: Record<string, unknown> = {
        stage_id: cfg.stage_id,
        updated_at: new Date().toISOString(),
      };
      if (deal.pipeline_id !== stage.pipeline_id) {
        update.pipeline_id = stage.pipeline_id;
      }
      let note = '';
      const stageName = String(stage.name ?? '');
      if (isLostStage(stageName)) {
        if (!cfg.lost_reason) {
          throw new Error(
            `move_deal_stage: ${stageName} is a lost stage and needs lost_reason`
          );
        }
        update.status = 'lost';
        update.lost_reason = cfg.lost_reason;
      } else if (isWonStage(stageName)) {
        if (Number(deal.value) > 0) {
          update.status = 'won';
        } else {
          note = ' (no value on the deal; status left open)';
        }
      }

      const { error } = await db
        .from('deals')
        .update(update)
        .eq('id', dealId)
        .eq('account_id', args.automation.account_id);
      if (error) throw new Error(`move_deal_stage: ${error.message}`);
      return `moved to ${stageName}${note}`;
    }

    case 'update_deal': {
      const cfg = step.step_config as UpdateDealStepConfig;
      const dealId = await resolveDealId(args);
      const value = await interpolate(cfg.value ?? '', args);
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      switch (cfg.field) {
        case 'title':
          if (!value.trim()) throw new Error('update_deal: title is empty');
          update.title = value;
          break;
        case 'value': {
          const n = Number(String(value).replace(',', '.'));
          if (!Number.isFinite(n) || n < 0) {
            throw new Error(`update_deal: "${value}" is not a value`);
          }
          update.value = n;
          break;
        }
        case 'expected_close_date':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
            throw new Error(
              `update_deal: "${value}" is not a date (YYYY-MM-DD)`
            );
          }
          update.expected_close_date = value.trim();
          break;
        case 'notes': {
          // Append, never replace: the notes are where a seller writes
          // what they agreed, and an automation must not erase that.
          const deal = await loadDeal(args, dealId);
          const existing = (deal?.notes as string | null | undefined) ?? '';
          update.notes = existing ? `${existing}\n${value}` : value;
          break;
        }
        default:
          throw new Error(
            `update_deal: field ${String(cfg.field)} not writable`
          );
      }
      const { error } = await db
        .from('deals')
        .update(update)
        .eq('id', dealId)
        .eq('account_id', args.automation.account_id);
      if (error) throw new Error(`update_deal: ${error.message}`);
      return `deal ${cfg.field} updated`;
    }

    case 'cancel_automations': {
      const cfg = step.step_config as CancelAutomationsStepConfig;
      const scope = cfg.scope === 'contact' ? 'contact' : 'deal';
      let dealId: string | null = args.context.deal_id ?? null;
      if (scope === 'deal' && !dealId) {
        try {
          dealId = await resolveDealId(args);
        } catch {
          return 'nothing to cancel: no deal for this run';
        }
      }
      const cancelled = await cancelPendingByStep(db, {
        accountId: args.automation.account_id,
        scope,
        dealId,
        contactId: args.contactId,
        automationIds: cfg.automation_ids,
        byAutomationId: args.automation.id,
      });
      return `cancelled ${cancelled} pending run${cancelled === 1 ? '' : 's'} (${scope})`;
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig;
      if (!cfg.url) throw new Error('send_webhook needs url');
      // SSRF guard: the URL and headers are account-controlled and the
      // server makes the request, so refuse any destination that resolves
      // to a private / loopback / link-local / reserved address. Mirrors
      // the webhook_endpoints delivery path (see lib/webhooks/deliver.ts).
      if (!(await isDeliverableUrl(cfg.url))) {
        throw new Error('send_webhook: destination not allowed');
      }
      const body = cfg.body_template
        ? await interpolate(cfg.body_template, args)
        : JSON.stringify(args.context);
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
        // Do NOT follow redirects — a public URL could 3xx-bounce to an
        // internal address, defeating the guard above. Bound the request
        // so a hung/slow internal host can't tie up the runner.
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`webhook returned ${res.status}`);
      return `webhook ${res.status}`;
    }

    case 'close_conversation': {
      if (!args.contactId)
        throw new Error('close_conversation needs a contact');
      await db
        .from('conversations')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId);
      return 'conversation closed';
    }

    default:
      return `unknown step: ${step.step_type}`;
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id;
  if (fromCtx) return fromCtx;
  if (!args.contactId)
    throw new Error('cannot resolve conversation: no contact');
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', args.automation.account_id)
    .eq('contact_id', args.contactId)
    .maybeSingle();
  if (error) throw new Error(`conversation lookup failed: ${error.message}`);
  if (!data?.id) {
    const prefix =
      args.triggerEvent === 'tag_added'
        ? 'tag_added automation cannot send'
        : 'cannot send';
    throw new Error(`${prefix}: contact has no existing conversation`);
  }
  return data.id as string;
}

/**
 * The deal a run works, resolved once and remembered on the context —
 * which the parked row and the nested scopes share by reference, so a
 * lazy resolution inside a step is seen by every step after it.
 *
 * Throws when there is none: a deal step without a deal has nothing to
 * do, and the log should say exactly that.
 */
async function resolveDealId(args: ExecuteArgs): Promise<string> {
  if (args.context.deal_id) return args.context.deal_id;
  if (!args.contactId) throw new Error('cannot resolve deal: no contact');
  const id = await findNewestOpenDeal(
    args.automation.account_id,
    args.contactId,
    args.automation.pipeline_id ?? null
  );
  if (!id) {
    throw new Error(
      args.automation.pipeline_id
        ? 'cannot resolve deal: contact has no open deal in this pipeline'
        : 'cannot resolve deal: contact has no open deal'
    );
  }
  args.context.deal_id = id;
  await setLogDeal(args.logId, id);
  return id;
}

/** Like `resolveDealId`, for the start of a run: never throws. */
async function resolveDealUpFront(
  automation: Automation,
  contactId: string | null,
  context: AutomationContext
): Promise<string | null> {
  if (context.deal_id) {
    // Caller-supplied (a stage event, a manual POST): confirm it is this
    // account's before the service-role client touches it.
    const { data } = await supabaseAdmin()
      .from('deals')
      .select('id')
      .eq('id', context.deal_id)
      .eq('account_id', automation.account_id)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }
  if (!contactId) return null;
  return findNewestOpenDeal(
    automation.account_id,
    contactId,
    automation.pipeline_id ?? null
  );
}

async function findNewestOpenDeal(
  accountId: string,
  contactId: string,
  pipelineId: string | null
): Promise<string | null> {
  let query = supabaseAdmin()
    .from('deals')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1);
  if (pipelineId) query = query.eq('pipeline_id', pipelineId);
  const { data, error } = await query;
  if (error) {
    console.error('[automations] deal lookup failed:', error.message);
    return null;
  }
  const rows = (data ?? []) as { id: string }[];
  return rows[0]?.id ?? null;
}

interface DealRow {
  id: string;
  stage_id: string;
  pipeline_id: string;
  status: string | null;
  value: number | null;
  notes?: string | null;
  stage_entered_at?: string | null;
  conversation_id?: string | null;
}

async function loadDeal(
  args: ExecuteArgs,
  dealId: string
): Promise<DealRow | null> {
  const { data } = await supabaseAdmin()
    .from('deals')
    .select(
      'id, stage_id, pipeline_id, status, value, notes, stage_entered_at, conversation_id'
    )
    .eq('id', dealId)
    .eq('account_id', args.automation.account_id)
    .maybeSingle();
  return (data as DealRow | null) ?? null;
}

/**
 * When a wait-until-date should wake: the instant the contact's date
 * reaches `at` on the wall clock of `timezone`. Null when the field is
 * empty — nothing to wait for.
 */
async function contactDateWake(
  automation: Automation,
  contactId: string | null,
  until: { field: string; at: string; timezone: string }
): Promise<Date | null> {
  if (!contactId) return null;
  const { data } = await supabaseAdmin()
    .from('contacts')
    .select(until.field)
    .eq('id', contactId)
    .eq('account_id', automation.account_id)
    .maybeSingle();
  const raw = (data as Record<string, unknown> | null)?.[until.field];
  if (!raw || typeof raw !== 'string') return null;
  const minutes = parseHHmm(until.at) ?? 9 * 60;
  return zonedTimeToUtc(raw, minutes, until.timezone);
}

/**
 * Park a run. Tolerates a pre-065 queue table (no `deal_id`) the same way
 * `insertLog` does, so a wait keeps working across the migration window.
 */
async function insertPending(input: {
  automation: Automation;
  contactId: string | null;
  dealId: string | null;
  logId: string | null;
  parentStepId: string | null;
  branch: 'yes' | 'no' | null;
  nextStepPosition: number;
  context: AutomationContext;
  runAt: Date;
}): Promise<void> {
  const db = supabaseAdmin();
  const base: Record<string, unknown> = {
    automation_id: input.automation.id,
    // Tenancy: account_id required NOT NULL post-017.
    account_id: input.automation.account_id,
    user_id: input.automation.user_id,
    contact_id: input.contactId,
    log_id: input.logId,
    parent_step_id: input.parentStepId,
    branch: input.branch,
    next_step_position: input.nextStepPosition,
    context: input.context,
    run_at: input.runAt.toISOString(),
    status: 'pending',
  };
  const { error } = await db
    .from('automation_pending_executions')
    .insert({ ...base, deal_id: input.dealId });
  if (error && isUnknownColumn(error)) {
    const retry = await db.from('automation_pending_executions').insert(base);
    if (retry.error) throw new Error(`cannot park run: ${retry.error.message}`);
    return;
  }
  if (error) throw new Error(`cannot park run: ${error.message}`);
}

/** Letter, digit or underscore in any script — the "inside a word" test. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

/**
 * Whole-word keyword test, behind `match_type: 'word'` (issue #409 — a
 * one-letter keyword under `contains` fires on every message containing
 * that letter, e.g. "k" on "thanks").
 *
 * Deliberately NOT `\b`, which is defined against `[A-Za-z0-9_]` and so
 * breaks two cases that matter for WhatsApp traffic:
 *
 *   - A keyword carrying punctuation: `/\bhi!\b/` demands a word character
 *     after the "!", so it never matches "say hi!".
 *   - Any non-Latin script: every character of "안녕" is a non-word
 *     character to `\b`, so `/\b안녕\b/` matches nothing at all.
 *
 * Unicode-aware lookarounds handle both. Note this really is word-based:
 * it won't find "안녕" inside "안녕하세요", because a language that doesn't
 * delimit words with spaces has no word edge there. That's what `contains`
 * is for, and it stays the default.
 *
 * Exported for direct unit testing of the escaping / boundary edges.
 */
export function matchesWholeWord(
  text: string,
  keyword: string,
  caseSensitive = false
): boolean {
  if (!keyword) return false;
  // The keyword is account-supplied free text, so metacharacters have to
  // be literal — otherwise "(" is an unterminated group and RegExp throws.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`,
    caseSensitive ? 'u' : 'iu'
  );
  return pattern.test(text);
}

export function triggerMatches(
  automation: Automation,
  ctx: AutomationContext | undefined
): boolean {
  if (automation.trigger_type === 'keyword_match') {
    const cfg = automation.trigger_config as KeywordMatchTriggerConfig;
    if (!cfg?.keywords || cfg.keywords.length === 0) return false;
    const text = (ctx?.message_text ?? '').toString();
    if (!text) return false;
    if (cfg.match_type === 'word') {
      return cfg.keywords.some((raw) =>
        matchesWholeWord(text, raw, cfg.case_sensitive)
      );
    }
    const haystack = cfg.case_sensitive ? text : text.toLowerCase();
    return cfg.keywords.some((raw) => {
      const k = cfg.case_sensitive ? raw : raw.toLowerCase();
      return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k);
    });
  }

  // Match on the tapped button / list-row id (exact). Lets multi-step
  // menus be chained: automation A sends buttons, automation B fires on
  // the reply id and sends the next step.
  if (automation.trigger_type === 'interactive_reply') {
    const cfg = automation.trigger_config as InteractiveReplyTriggerConfig;
    const replyId = ctx?.interactive_reply_id;
    if (
      !replyId ||
      !Array.isArray(cfg?.reply_ids) ||
      cfg.reply_ids.length === 0
    ) {
      return false;
    }
    return cfg.reply_ids.includes(replyId);
  }

  if (automation.trigger_type === 'tag_added') {
    const cfg = automation.trigger_config as TagTriggerConfig;
    const tagId = ctx?.tag_id;
    return Boolean(tagId && cfg?.tag_id && cfg.tag_id === tagId);
  }

  // The stage the deal entered, exact. Fails closed on either side missing.
  if (automation.trigger_type === 'deal_stage_entered') {
    const cfg = automation.trigger_config as DealStageEnteredTriggerConfig;
    const stageId = ctx?.stage_id;
    return Boolean(stageId && cfg?.stage_id && cfg.stage_id === stageId);
  }

  // The quick reply used or the template sent — either one, exact. An
  // automation that names neither matches nothing rather than everything.
  if (automation.trigger_type === 'team_message_sent') {
    const cfg = automation.trigger_config as TeamMessageSentTriggerConfig;
    const wantQr = (cfg?.quick_reply_id ?? '').trim();
    const wantTpl = (cfg?.template_name ?? '').trim();
    if (!wantQr && !wantTpl) return false;
    if (wantQr && ctx?.quick_reply_id === wantQr) return true;
    if (wantTpl && ctx?.template_name === wantTpl) return true;
    return false;
  }

  // Which contact date is today — so a birthday automation does not fire
  // on the sweep for next_purchase_expected_at.
  if (automation.trigger_type === 'date_field_reached') {
    const cfg = automation.trigger_config as DateFieldReachedTriggerConfig;
    return Boolean(
      cfg?.field && ctx?.date_field && cfg.field === ctx.date_field
    );
  }

  return true;
}

async function evaluateCondition(
  cfg: ConditionStepConfig,
  args: ExecuteArgs
): Promise<boolean> {
  const db = supabaseAdmin();
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false;
      // contact_tags has no account_id column (its RLS keys off the parent
      // contact), so tenant scoping here relies on the contact-ownership
      // guard in runAutomationsForTrigger.
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.operand);
      return (count ?? 0) > 0;
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false;
      // Scope to the account so the condition can't be turned into a
      // cross-tenant read oracle via the service-role client.
      const { data } = await db
        .from('contacts')
        .select(cfg.operand)
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle();
      const v = (data as Record<string, unknown> | null)?.[cfg.operand];
      return v != null && String(v) === String(cfg.value ?? '');
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString();
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase());
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-');
      if (!from || !to) return false;
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const f = parse(from);
      const t = parse(to);
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t;
    }

    // ---- Deal conditions (065). All three answer "no" rather than
    // throwing when the run has no deal: a condition is a question, and
    // "there is no deal" is a valid answer to "is the deal in stage X".
    case 'deal_in_stage': {
      const wanted = conditionStageIds(cfg);
      if (wanted.length === 0) return false;
      const deal = await softDeal(args);
      return !!deal && wanted.includes(deal.stage_id);
    }
    case 'deal_is_open': {
      const deal = await softDeal(args);
      return !!deal && deal.status === 'open';
    }
    case 'customer_replied_since': {
      const since =
        cfg.operand === 'run_start'
          ? (args.context.run_started_at ?? null)
          : ((await softDeal(args))?.stage_entered_at ?? null);
      if (!since) return false;
      let conversationId: string;
      try {
        conversationId = await resolveConversationId(args);
      } catch {
        return false;
      }
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'customer')
        .gt('created_at', since);
      return (count ?? 0) > 0;
    }
    default:
      return false;
  }
}

/** The stage ids a `deal_in_stage` condition names — the list, or the
 *  operand as a comma-separated fallback. */
function conditionStageIds(cfg: ConditionStepConfig): string[] {
  if (Array.isArray(cfg.stage_ids) && cfg.stage_ids.length > 0) {
    return cfg.stage_ids.map((s) => String(s).trim()).filter(Boolean);
  }
  return (cfg.operand ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The run's deal for a condition: resolved if possible, null if not. */
async function softDeal(args: ExecuteArgs): Promise<DealRow | null> {
  let dealId: string;
  try {
    dealId = await resolveDealId(args);
  } catch {
    return null;
  }
  return loadDeal(args, dealId);
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs =
    cfg.unit === 'days'
      ? 86_400_000
      : cfg.unit === 'hours'
        ? 3_600_000
        : 60_000;
  return Math.max(1_000, cfg.amount * unitMs);
}

/**
 * Per-run cache of the contact and deal rows `interpolate` reads, keyed by
 * the context object — which every scope of a run shares by reference and
 * which is never the same object across runs. A WeakMap rather than a
 * field on the context so nothing of it is serialised onto a parked row.
 */
const runCache = new WeakMap<
  AutomationContext,
  { contact?: Record<string, unknown> | null; deal?: DealRow | null }
>();

/** Contact columns a template may read. Deliberately not the whole row. */
const CONTACT_FIELDS = 'name, company, phone, email, city, state, job_title';

async function cachedContact(
  args: ExecuteArgs
): Promise<Record<string, unknown> | null> {
  const cache = runCache.get(args.context) ?? {};
  if ('contact' in cache) return cache.contact ?? null;
  let row: Record<string, unknown> | null = null;
  if (args.contactId) {
    const { data } = await supabaseAdmin()
      .from('contacts')
      .select(CONTACT_FIELDS)
      .eq('id', args.contactId)
      .eq('account_id', args.automation.account_id)
      .maybeSingle();
    row = (data as Record<string, unknown> | null) ?? null;
  }
  runCache.set(args.context, { ...cache, contact: row });
  return row;
}

async function cachedDeal(args: ExecuteArgs): Promise<DealRow | null> {
  const cache = runCache.get(args.context) ?? {};
  if ('deal' in cache) return cache.deal ?? null;
  const row = await softDeal(args);
  runCache.set(args.context, { ...cache, deal: row });
  return row;
}

/**
 * `{{vars.x}}` and `{{message.text}}` as before, plus the two families the
 * official flow's templates need: `{{contact.name}}`, `{{contact.first_name}}`
 * (with `company`, `phone`, `email`, `city`, `state`, `job_title`) and
 * `{{deal.title}}` / `{{deal.value}}`. Rows are read once per run and only
 * when a placeholder asks for them, so a step with no placeholders costs
 * nothing extra.
 *
 * `first_name` falls back to "cliente" when the record has no name: a
 * greeting template with an empty parameter is refused by Meta, and a
 * follow-up that never goes out is worse than one that says "Olá, cliente".
 */
async function interpolate(s: string, args: ExecuteArgs): Promise<string> {
  if (!s || !s.includes('{{')) return s ?? '';
  const contact = /\{\{\s*contact\./.test(s) ? await cachedContact(args) : null;
  const deal = /\{\{\s*deal\./.test(s) ? await cachedDeal(args) : null;
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.');
    if (ns === 'message' && prop === 'text')
      return String(args.context.message_text ?? '');
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '');
    if (ns === 'contact' && prop) {
      if (prop === 'first_name') {
        const name = String(contact?.name ?? '').trim();
        return name ? (name.split(/\s+/)[0] ?? name) : 'cliente';
      }
      const v = contact?.[prop];
      return v == null ? '' : String(v);
    }
    if (ns === 'deal' && prop) {
      const v = (deal as Record<string, unknown> | null)?.[prop];
      return v == null ? '' : String(v);
    }
    return '';
  });
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: AutomationLogStatus | null,
  errorMessage: string | null
) {
  if (!logId) return;
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from('automation_logs')
    .select('steps_executed, status')
    .eq('id', logId)
    .single();
  const merged = [
    ...((existing?.steps_executed as AutomationLogStepResult[] | undefined) ??
      []),
    ...newItems,
  ];
  const update: Record<string, unknown> = { steps_executed: merged };
  // Only overwrite status on the outermost scope — nested branches pass null.
  if (status !== null) {
    update.status = status;
  }
  if (errorMessage) update.error_message = errorMessage;
  await db.from('automation_logs').update(update).eq('id', logId);
}

async function finalizeLog(
  logId: string | null,
  status: AutomationLogStatus,
  errorMessage: string | null
) {
  if (!logId) return;
  await supabaseAdmin()
    .from('automation_logs')
    .update({ status, error_message: errorMessage })
    .eq('id', logId);
}

/**
 * Why the run ended, on the log. Best-effort and tolerant of a pre-065
 * log table: the reason is the one thing the migration window may lose.
 */
async function setEndReason(
  logId: string | null,
  reason: string,
  status?: AutomationLogStatus
) {
  if (!logId) return;
  const update: Record<string, unknown> = { end_reason: reason };
  if (status) update.status = status;
  const { error } = await supabaseAdmin()
    .from('automation_logs')
    .update(update)
    .eq('id', logId);
  if (error && !isUnknownColumn(error)) {
    console.error('[automations] end_reason update failed:', error.message);
  }
}

/** The deal a run resolved lazily, onto its log. Best-effort. */
async function setLogDeal(logId: string | null, dealId: string) {
  if (!logId) return;
  const { error } = await supabaseAdmin()
    .from('automation_logs')
    .update({ deal_id: dealId })
    .eq('id', logId);
  if (error && !isUnknownColumn(error)) {
    console.error('[automations] log deal update failed:', error.message);
  }
}

async function markPending(id: string, status: 'done' | 'failed') {
  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ status })
    .eq('id', id);
}
