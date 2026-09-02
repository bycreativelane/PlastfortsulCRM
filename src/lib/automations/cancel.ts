import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cancelling parked runs — the rule the official flow states seven times
 * and the engine had no way to obey.
 *
 * A `wait` step parks a run as a row in `automation_pending_executions`.
 * Until migration 065 nothing ever touched that row before it came due, so
 * a customer who answered the D1 follow-up still received the D3. Three
 * things now do:
 *
 *   cancelPendingOnReply       the inbound webhook, before any trigger fires
 *   cancelPendingOnStageEnter  the stage-event drainer, before the trigger
 *   cancelPendingByStep        the explicit "Cancelar automações" step
 *
 * Cancelling is a status and a reason, never a delete. The row stays so
 * the log can say "D3 was scheduled and here is why it did not go out",
 * and the agenda stops showing it because the agenda filters `pending`.
 *
 * Every function is best-effort and never throws: a cancellation that
 * fails must not take the webhook, the cron or a running automation down
 * with it. Failures are logged and counted as zero.
 */

interface PendingRow {
  id: string;
  log_id: string | null;
  automation_id: string;
  automations?:
    | {
        cancel_on_reply?: boolean | null;
        cancel_when_stage_in?: string[] | null;
      }
    | {
        cancel_on_reply?: boolean | null;
        cancel_when_stage_in?: string[] | null;
      }[]
    | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * Flip the given rows to `cancelled` and close their logs.
 *
 * Two writes per row rather than one `IN (...)` update, because the log
 * ids are per row and the count of rows here is the count of parked runs
 * for ONE contact or deal — a handful, never a table.
 */
export async function cancelRows(
  db: SupabaseClient,
  rows: Pick<PendingRow, 'id' | 'log_id'>[],
  reason: string
): Promise<number> {
  let cancelled = 0;
  for (const row of rows) {
    // `status = 'pending'` in the filter is the race guard: a row the cron
    // claimed a millisecond ago is `running` and must finish or fail on its
    // own — flipping it under the runner would leave a log that says
    // cancelled next to a message that went out.
    const { data, error } = await db
      .from('automation_pending_executions')
      .update({ status: 'cancelled', cancelled_reason: reason })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[automations] cancel failed:', row.id, error.message);
      continue;
    }
    if (!data) continue;
    cancelled++;
    if (row.log_id) {
      const { error: logErr } = await db
        .from('automation_logs')
        .update({
          status: 'cancelled',
          end_reason: reason,
          error_message: null,
        })
        .eq('id', row.log_id);
      if (logErr) {
        console.error(
          '[automations] cancel log update failed:',
          logErr.message
        );
      }
    }
  }
  return cancelled;
}

/**
 * The customer wrote: cancel every parked run, for this contact, of an
 * automation that asked to be cancelled on reply.
 */
export async function cancelPendingOnReply(
  db: SupabaseClient,
  input: { accountId: string; contactId: string }
): Promise<number> {
  try {
    const { data, error } = await db
      .from('automation_pending_executions')
      .select('id, log_id, automation_id, automations(cancel_on_reply)')
      .eq('account_id', input.accountId)
      .eq('contact_id', input.contactId)
      .eq('status', 'pending');
    if (error) {
      console.error(
        '[automations] cancelPendingOnReply query failed:',
        error.message
      );
      return 0;
    }
    const rows = ((data ?? []) as PendingRow[]).filter(
      (r) => one(r.automations)?.cancel_on_reply === true
    );
    if (rows.length === 0) return 0;
    return await cancelRows(db, rows, 'customer_replied');
  } catch (err) {
    console.error('[automations] cancelPendingOnReply threw:', err);
    return 0;
  }
}

/**
 * The deal entered a stage: cancel every parked run, for this deal, of an
 * automation that listed the stage in `cancel_when_stage_in`.
 */
export async function cancelPendingOnStageEnter(
  db: SupabaseClient,
  input: { accountId: string; dealId: string; stageId: string }
): Promise<number> {
  try {
    const { data, error } = await db
      .from('automation_pending_executions')
      .select('id, log_id, automation_id, automations(cancel_when_stage_in)')
      .eq('account_id', input.accountId)
      .eq('deal_id', input.dealId)
      .eq('status', 'pending');
    if (error) {
      console.error(
        '[automations] cancelPendingOnStageEnter query failed:',
        error.message
      );
      return 0;
    }
    const rows = ((data ?? []) as PendingRow[]).filter((r) => {
      const list = one(r.automations)?.cancel_when_stage_in;
      return Array.isArray(list) && list.includes(input.stageId);
    });
    if (rows.length === 0) return 0;
    return await cancelRows(db, rows, `stage_entered:${input.stageId}`);
  } catch (err) {
    console.error('[automations] cancelPendingOnStageEnter threw:', err);
    return 0;
  }
}

/**
 * The "Cancelar automações" step. `scope: 'deal'` reaches the parked runs
 * of this run's deal; `'contact'` reaches every parked run of the contact.
 * With no `automationIds`, every automation except the one running — a
 * step that cancelled its own previous run is a foot-gun nobody asked for.
 */
export async function cancelPendingByStep(
  db: SupabaseClient,
  input: {
    accountId: string;
    scope: 'deal' | 'contact';
    dealId: string | null;
    contactId: string | null;
    automationIds?: string[];
    /** The automation running the step. */
    byAutomationId: string;
  }
): Promise<number> {
  try {
    let query = db
      .from('automation_pending_executions')
      .select('id, log_id, automation_id')
      .eq('account_id', input.accountId)
      .eq('status', 'pending');
    if (input.scope === 'deal') {
      if (!input.dealId) return 0;
      query = query.eq('deal_id', input.dealId);
    } else {
      if (!input.contactId) return 0;
      query = query.eq('contact_id', input.contactId);
    }
    const { data, error } = await query;
    if (error) {
      console.error(
        '[automations] cancelPendingByStep query failed:',
        error.message
      );
      return 0;
    }
    const wanted =
      input.automationIds && input.automationIds.length > 0
        ? new Set(input.automationIds)
        : null;
    const rows = ((data ?? []) as PendingRow[]).filter((r) =>
      wanted
        ? wanted.has(r.automation_id)
        : r.automation_id !== input.byAutomationId
    );
    if (rows.length === 0) return 0;
    return await cancelRows(db, rows, `cancelled_by:${input.byAutomationId}`);
  } catch (err) {
    console.error('[automations] cancelPendingByStep threw:', err);
    return 0;
  }
}
