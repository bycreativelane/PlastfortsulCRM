import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sweepStalledConversations } from '@/lib/conversations/handover-sweep';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resumePendingExecution } from '@/lib/automations/engine';
import type { AutomationContext } from '@/lib/automations/engine';
import { drainDealStageEvents } from '@/lib/automations/stage-events';
import { runDateFieldSweeps } from '@/lib/automations/date-sweep';

/**
 * The automation engine's clock. Meant to be hit EVERY MINUTE by a
 * scheduler (host cron, GitHub Actions `schedule`, a paid Vercel cron) —
 * requires a shared secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * Four jobs, in an order that is not negotiable:
 *
 *   1. Stage events → `deal_stage_entered`. Migration 065's trigger writes
 *      one row per stage change of every deal; this drains them. Each one
 *      first applies the cancellation rule for the stage entered, THEN
 *      fires the trigger — so a follow-up parked for a deal that just
 *      reached Em Negociação is cancelled before anything new starts.
 *   2. Due waits. After the events, so a wait that came due in the same
 *      minute a cancellation landed does not wake and send anyway.
 *   3. Date sweeps (birthday). Idempotent per contact and day.
 *   4. The stalled-conversation handover sweep.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // 1. Stage events. Never throws; a pre-065 database reports zero.
  const stageEvents = await drainDealStageEvents().catch((err) => {
    console.error('[cron] stage event drain failed:', err);
    return { processed: 0, dispatched: 0, suppressed: 0 };
  });

  // 2. Due waits.
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  let processed = 0;
  for (const row of due ?? []) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claim) continue;

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    });
    processed++;
  }

  // 3. Date sweeps.
  const sweeps = await runDateFieldSweeps().catch((err) => {
    console.error('[cron] date sweep failed:', err);
    return { automations: 0, dispatched: 0 };
  });

  /**
   * 4. The stalled-conversation sweep rides this tick.
   *
   * After the automations, not before: a pending automation may itself
   * be the reply that clears the wait, and handing the conversation to
   * somebody else a second earlier would move work that was about to be
   * done.
   *
   * Never throws — one account's failure is caught inside, and a sweep
   * that broke must not turn the automations run into a 500 the
   * scheduler retries.
   */
  const sweep = await sweepStalledConversations().catch((err) => {
    console.error('[cron] handover sweep failed:', err);
    return { scanned: 0, handed: [] };
  });

  return NextResponse.json({
    processed,
    stageEvents: stageEvents.dispatched,
    stageEventsSuppressed: stageEvents.suppressed,
    dateDispatches: sweeps.dispatched,
    handedOver: sweep.handed.length,
  });
}
