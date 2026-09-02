/**
 * The automation-level rules of migration 065, read off a request body.
 *
 * Only keys the caller sent are returned, so a PATCH that says nothing
 * about them changes nothing — the list page's activate switch sends
 * `{ is_active }` alone and must not reset a funnel or a cancellation
 * rule on the way.
 *
 * A module of its own because a `route.ts` may export nothing but its
 * HTTP methods, and both the create and the update route read the same
 * five fields.
 */
export function readRuleFields(
  body: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('pipeline_id' in body) {
    out.pipeline_id =
      typeof body.pipeline_id === 'string' && body.pipeline_id.trim()
        ? body.pipeline_id.trim()
        : null;
  }
  if ('cancel_on_reply' in body) out.cancel_on_reply = !!body.cancel_on_reply;
  if ('cancel_when_stage_in' in body) {
    out.cancel_when_stage_in = Array.isArray(body.cancel_when_stage_in)
      ? body.cancel_when_stage_in
      : [];
  }
  if ('reentry_policy' in body) {
    out.reentry_policy =
      typeof body.reentry_policy === 'string' && body.reentry_policy
        ? body.reentry_policy
        : 'always';
  }
  if ('reentry_days' in body) {
    out.reentry_days =
      body.reentry_days === null || body.reentry_days === undefined
        ? null
        : Number(body.reentry_days);
  }
  return out;
}
