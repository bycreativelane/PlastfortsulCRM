import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuditAction } from './events';

// ============================================================
// Writing to the log.
//
// One function, called from the API routes that do consequential things.
// It NEVER THROWS and it never fails the caller: an audit row is a
// record OF an action, and an action that succeeded and then reported
// failure because its footnote could not be written would be the worst
// of both — the change happened, the user was told it did not, and they
// do it again.
//
// The cost of that choice is stated plainly: this log can have holes in
// it. A row missing because the insert failed is indistinguishable from
// an action that never happened. That is the right trade here — the
// alternative is a settings page that goes down when one table does —
// but it means this is a record for humans asking "quem mexeu nisso",
// not evidence.
// ============================================================

export interface LogAuditArgs {
  accountId: string;
  /** `auth.users.id` of whoever did it. Null for system-initiated acts. */
  actorUserId: string | null;
  /**
   * Their name at this moment, frozen into the row.
   *
   * Not a nicety. The rows worth reading a year from now are the ones
   * about people who have since left, and `actor_user_id` is SET NULL
   * for exactly those — so without this the interesting half of the log
   * says "alguém".
   */
  actorLabel?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append one row. Pass the service-role client from an API route — there
 * is no client INSERT policy on `account_audit_log` (migration 050), so
 * an RLS-scoped client writes nothing and says nothing.
 */
export async function logAuditEvent(
  db: SupabaseClient,
  args: LogAuditArgs
): Promise<void> {
  try {
    const { error } = await db.from('account_audit_log').insert({
      account_id: args.accountId,
      actor_user_id: args.actorUserId,
      actor_label: args.actorLabel ?? null,
      action: args.action,
      target_type: args.targetType ?? null,
      target_id: args.targetId ?? null,
      target_label: args.targetLabel ?? null,
      metadata: args.metadata ?? {},
    });
    if (error) {
      // Includes the pre-050 case, where the table does not exist yet.
      // One line rather than a thrown error — see the note at the top.
      console.error('[audit] insert failed:', error.message);
    }
  } catch (err) {
    console.error('[audit] insert threw:', err);
  }
}

/**
 * The actor's display name, for `actorLabel`.
 *
 * A separate round trip, and worth it: every caller has the actor's uid
 * and none of them has their name, so without this helper each route
 * would either skip the label (leaving the log unreadable) or grow its
 * own copy of this query.
 */
export async function auditActorLabel(
  db: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await db
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .maybeSingle();
  const row = data as { full_name?: string | null; email?: string | null } | null;
  return row?.full_name || row?.email || null;
}
