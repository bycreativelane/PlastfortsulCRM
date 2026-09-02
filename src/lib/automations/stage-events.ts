import type { SupabaseClient } from '@supabase/supabase-js';

import type { DealStageEvent } from '@/types';
import { supabaseAdmin } from './admin-client';
import { cancelPendingOnStageEnter } from './cancel';
import { runAutomationsForTrigger } from './engine';

/**
 * From `deal_stage_events` to the `deal_stage_entered` trigger.
 *
 * The database trigger of migration 065 writes a row for every stage change
 * of every deal, whoever made it — the board, the thread header, the deal
 * form, the outcome dialog, the public API, or the engine's own
 * `move_deal_stage` step. This drainer runs on the cron tick, claims each
 * undispatched row, applies the cancellation rule for the stage the deal
 * just entered, and fires the trigger.
 *
 * Why an outbox and not a call inside the write: there are four client-side
 * writes of `stage_id` today and there will be a fifth. A row the database
 * writes itself cannot be forgotten by a caller. The price is one cron tick
 * of latency, which is why the scheduler has to run every minute.
 *
 * LOOP GUARD. Automation A moves the deal to X, X's automation moves it
 * back to A's stage, and so on, once per tick, forever — with no in-process
 * recursion for a depth counter to catch. The guard is a rate: a deal that
 * changed stage more than `MAX_EVENTS_PER_HOUR` times in the last hour has
 * its events marked dispatched WITHOUT firing anything, and the fact is
 * logged. A real funnel never moves that fast; a loop always does.
 */
export const MAX_EVENTS_PER_HOUR = 12;

export interface DrainResult {
  processed: number;
  dispatched: number;
  suppressed: number;
}

export async function drainDealStageEvents(
  limit = 100,
  db: SupabaseClient = supabaseAdmin()
): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, dispatched: 0, suppressed: 0 };

  const { data: events, error } = await db
    .from('deal_stage_events')
    .select('*')
    .is('dispatched_at', null)
    .order('changed_at', { ascending: true })
    .limit(limit);

  if (error) {
    // Pre-065 the table does not exist. That is not a cron failure — it is
    // a feature waiting on a migration, and the rest of the tick must run.
    console.error('[stage-events] fetch failed:', error.message);
    return result;
  }
  if (!events || events.length === 0) return result;

  for (const event of events as DealStageEvent[]) {
    // Claim. Two overlapping ticks both read the row; only one gets it.
    const { data: claimed, error: claimErr } = await db
      .from('deal_stage_events')
      .update({ dispatched_at: new Date().toISOString() })
      .eq('id', event.id)
      .is('dispatched_at', null)
      .select('id')
      .maybeSingle();
    if (claimErr) {
      console.error('[stage-events] claim failed:', event.id, claimErr.message);
      continue;
    }
    if (!claimed) continue;
    result.processed++;

    try {
      const { data: deal } = await db
        .from('deals')
        .select('id, contact_id, pipeline_id, account_id')
        .eq('id', event.deal_id)
        .eq('account_id', event.account_id)
        .maybeSingle();
      if (!deal) continue;

      // The cancellation rule comes BEFORE the trigger: a follow-up parked
      // for this deal must be gone before "entered Em Negociação" starts
      // anything new for it.
      await cancelPendingOnStageEnter(db, {
        accountId: event.account_id,
        dealId: event.deal_id,
        stageId: event.to_stage_id,
      });

      if (await isLooping(db, event)) {
        result.suppressed++;
        console.warn(
          '[stage-events] deal is changing stage too fast; trigger suppressed',
          {
            dealId: event.deal_id,
            accountId: event.account_id,
          }
        );
        continue;
      }

      // A deal whose contact was deleted has nobody to talk to and no
      // conversation to send into; the engine would refuse it anyway.
      if (!deal.contact_id) continue;

      await runAutomationsForTrigger({
        accountId: event.account_id,
        triggerType: 'deal_stage_entered',
        contactId: deal.contact_id as string,
        context: {
          deal_id: event.deal_id,
          stage_id: event.to_stage_id,
          from_stage_id: event.from_stage_id ?? undefined,
          stage_event_id: event.id,
        },
      });
      result.dispatched++;
    } catch (err) {
      console.error('[stage-events] dispatch failed:', event.id, err);
    }
  }

  return result;
}

async function isLooping(
  db: SupabaseClient,
  event: DealStageEvent
): Promise<boolean> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error } = await db
    .from('deal_stage_events')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', event.deal_id)
    .gte('changed_at', since);
  if (error) return false;
  return (count ?? 0) > MAX_EVENTS_PER_HOUR;
}
