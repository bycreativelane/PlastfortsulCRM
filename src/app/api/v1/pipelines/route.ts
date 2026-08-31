// ============================================================
// GET /api/v1/pipelines — funnels and their stages (scope: deals:read)
//
// Creating a deal needs a `stage_id`, and there was no way to learn one
// from outside. This is that lookup: one call, every pipeline, every
// stage in position order.
//
// `kind` is inferred here — from the stage NAME, which is how the whole
// product decides today (`isWonStage` in lib/deals/outcome.ts). It is
// published as a hint and labelled as one, because a caller building an
// offline-conversion export needs to know which stage means "sold" and
// guessing from a Portuguese string on their side would be worse than
// guessing on ours.
//
// When stages get a real `kind` column, this field starts telling the
// truth and no caller changes.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { isWonStage, isLostStage } from '@/lib/deals/outcome';

interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  color: string;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');

    const [pipelineRes, stageRes] = await Promise.all([
      ctx.supabase
        .from('pipelines')
        .select('id, name, created_at')
        .eq('account_id', ctx.accountId)
        .order('created_at'),
      ctx.supabase
        .from('pipeline_stages')
        .select('id, pipeline_id, name, position, color')
        .order('position'),
    ]);

    if (pipelineRes.error) return toApiErrorResponse(pipelineRes.error);

    // Stages are filtered through the pipelines we just authorised
    // rather than queried by account: `pipeline_stages` has no
    // `account_id` of its own (it inherits tenancy through the
    // pipeline), so filtering here is what keeps the join honest.
    const pipelines = (pipelineRes.data ?? []) as {
      id: string;
      name: string;
      created_at: string;
    }[];
    const known = new Set(pipelines.map((p) => p.id));
    const stages = ((stageRes.data ?? []) as StageRow[]).filter((s) =>
      known.has(s.pipeline_id)
    );

    return ok({
      pipelines: pipelines.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        created_at: pipeline.created_at,
        stages: stages
          .filter((s) => s.pipeline_id === pipeline.id)
          .map((s) => ({
            id: s.id,
            name: s.name,
            position: s.position,
            color: s.color,
            // "won" | "lost" | "open", INFERRED FROM THE NAME.
            //
            // Named `kind_hint` and not `kind` on purpose: a caller
            // reading `kind` would reasonably assume somebody declared
            // it. Nobody did — it is `isWonStage` matching a list of
            // words, and a stage called "Faturado" is not on that list.
            kind_hint: isWonStage(s.name)
              ? 'won'
              : isLostStage(s.name)
                ? 'lost'
                : 'open',
          })),
      })),
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
