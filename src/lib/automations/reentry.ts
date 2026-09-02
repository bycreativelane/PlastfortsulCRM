import type { SupabaseClient } from '@supabase/supabase-js';

import type { Automation } from '@/types';

/**
 * Whether an automation may start a run right now for this subject.
 *
 * Two rules, from §23 of the official flow:
 *
 *   1. Never two runs of the same automation for the same deal at once.
 *      Unconditional — but only for DEAL-SCOPED runs, i.e. an automation
 *      that declared its funnel or was fired by a stage event. A welcome
 *      automation with no funnel keeps firing per message exactly as it
 *      did before migration 065.
 *
 *   2. The reentry policy, per automation:
 *        always          — the pre-065 behaviour and the default.
 *        after_complete  — not while a run is parked for this subject.
 *        never           — once per subject, ever.
 *        after_days      — not within `reentry_days` of the last run.
 *
 * The subject is the deal when the run is deal-scoped, else the contact.
 * A refusal is not silent: the caller writes a `skipped` log row with the
 * reason, so a customer who was NOT messaged twice can be seen not to be.
 */
export type ReentryReason = 'already_running' | 'reentry_blocked';

export interface ReentrySubject {
  contactId: string | null;
  dealId: string | null;
  dealScoped: boolean;
}

export async function checkReentry(
  db: SupabaseClient,
  automation: Automation,
  subject: ReentrySubject
): Promise<ReentryReason | null> {
  const column =
    subject.dealScoped && subject.dealId ? 'deal_id' : 'contact_id';
  const id = column === 'deal_id' ? subject.dealId : subject.contactId;
  if (!id) return null;

  const policy = automation.reentry_policy ?? 'always';

  // Rule 1, and the `after_complete` half of rule 2: is a run parked?
  if ((subject.dealScoped && subject.dealId) || policy === 'after_complete') {
    const { data, error } = await db
      .from('automation_pending_executions')
      .select('id')
      .eq('automation_id', automation.id)
      .eq(column, id)
      .eq('status', 'pending')
      .limit(1);
    if (error) {
      // Pre-065 there is no deal_id column on the queue. Failing open is
      // the pre-065 behaviour, so it is the right degradation.
      console.error(
        '[automations] reentry pending check failed:',
        error.message
      );
    } else if (data && data.length > 0) {
      return subject.dealScoped && column === 'deal_id'
        ? 'already_running'
        : 'reentry_blocked';
    }
  }

  if (policy === 'never' || policy === 'after_days') {
    let query = db
      .from('automation_logs')
      .select('id')
      .eq('automation_id', automation.id)
      .eq(column, id)
      .neq('status', 'skipped')
      .limit(1);
    if (policy === 'after_days') {
      const days = automation.reentry_days ?? 0;
      if (days <= 0) return null;
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      query = query.gte('created_at', since);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[automations] reentry log check failed:', error.message);
      return null;
    }
    if (data && data.length > 0) return 'reentry_blocked';
  }

  return null;
}
