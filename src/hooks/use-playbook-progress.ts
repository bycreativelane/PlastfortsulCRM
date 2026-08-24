'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { Deal, PipelineStage } from '@/types';

/** How many deal ids fit in one `IN (...)` before the URL gets silly. */
const DEAL_ID_CHUNK = 100;

export interface PlaybookProgress {
  /** How many steps the deal's current stage asks for. 0 = no playbook. */
  total: number;
  /** How many of those are ticked. */
  done: number;
}

/**
 * Playbook progress for a whole board, in two queries.
 *
 * The alternative — asking per card — is one round trip per deal on every
 * render of a board that routinely holds forty of them. These are two `IN`
 * queries whose result is a pair of maps, and the board reads them by key.
 *
 * Progress rows survive a deal moving stage (they are per step, and the step
 * belongs to the stage it was written for), so a deal's "done" count is
 * deliberately narrowed to the steps of the stage it is in NOW. A deal that
 * completed all four steps of Qualified and moved to Proposal shows 0/3 —
 * which is the truth about what is left to do, and the only question the
 * board is asking.
 */
export function usePlaybookProgress(
  stages: PipelineStage[],
  deals: Deal[]
): { progress: Map<string, PlaybookProgress>; refresh: () => void } {
  const [progress, setProgress] = useState<Map<string, PlaybookProgress>>(
    new Map()
  );

  const load = useCallback(async () => {
    const stageIds = stages.map((s) => s.id);
    const dealIds = deals.map((d) => d.id);
    if (stageIds.length === 0 || dealIds.length === 0) {
      setProgress(new Map());
      return;
    }

    const supabase = createClient();

    const stepRes = await supabase
      .from('playbook_steps')
      .select('id, stage_id')
      .in('stage_id', stageIds);

    const steps = (stepRes.data ?? []) as { id: string; stage_id: string }[];
    // Nothing in this pipeline has a playbook. Skip the second query
    // entirely rather than fetching ticks nothing will be counted against.
    if (steps.length === 0) {
      setProgress(new Map());
      return;
    }

    // `.in()` becomes a query string, and a board can legitimately hold
    // hundreds of deals: 200 UUIDs is ~7.5KB of URL, past what some proxies
    // will forward. Chunked, so the request stays a request no matter how
    // big the pipeline gets.
    const doneRows: { deal_id: string; step_id: string }[] = [];
    for (let i = 0; i < dealIds.length; i += DEAL_ID_CHUNK) {
      const { data } = await supabase
        .from('deal_playbook_progress')
        .select('deal_id, step_id')
        .in('deal_id', dealIds.slice(i, i + DEAL_ID_CHUNK));
      if (data) doneRows.push(...(data as { deal_id: string; step_id: string }[]));
    }

    const stageOfStep = new Map(steps.map((s) => [s.id, s.stage_id]));
    const totalByStage = new Map<string, number>();
    for (const step of steps) {
      totalByStage.set(
        step.stage_id,
        (totalByStage.get(step.stage_id) ?? 0) + 1
      );
    }

    const dealStage = new Map(deals.map((d) => [d.id, d.stage_id]));
    const doneByDeal = new Map<string, number>();
    for (const row of doneRows) {
      // Only steps belonging to the deal's CURRENT stage count toward what
      // is left; the rest are history from stages it has already left.
      if (stageOfStep.get(row.step_id) !== dealStage.get(row.deal_id)) continue;
      doneByDeal.set(row.deal_id, (doneByDeal.get(row.deal_id) ?? 0) + 1);
    }

    const next = new Map<string, PlaybookProgress>();
    for (const deal of deals) {
      const total = totalByStage.get(deal.stage_id) ?? 0;
      if (total === 0) continue;
      next.set(deal.id, { total, done: doneByDeal.get(deal.id) ?? 0 });
    }
    setProgress(next);
  }, [stages, deals]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { progress, refresh: load };
}
