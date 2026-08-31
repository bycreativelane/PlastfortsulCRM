import type { SupabaseClient } from '@supabase/supabase-js';

import { derivePresence } from '@/lib/presence';
import { hasMinRole, isAccountRole, type AccountRole } from '@/lib/auth/roles';
import { loadTeamPerformance } from '@/lib/team/performance';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';

/**
 * Handing a new conversation to somebody, automatically.
 *
 * WHAT WAS THERE BEFORE. `assign_conversation` has offered a `round_robin`
 * mode since the automations engine was written, and it reads
 * `profiles ... limit(1)`. There is no rotation: every conversation goes to
 * whichever row PostgREST returns first, forever. The comment in
 * `engine.ts` says so in as many words — "preserving that shape until a real
 * round-robin algorithm replaces it". This is that.
 *
 * PRESENCE IS THE POINT. A rotation that ignores who is at their desk is
 * worse than no rotation at all: it takes a customer waiting for an answer
 * and files them under somebody who went home, which is how a thread ends up
 * owned and unanswered — invisible in the unassigned queue precisely because
 * it has an owner. So the rotation runs over members who are online, using
 * the same `derivePresence` the avatars in the thread header use, so what
 * the interface shows and what the router believes cannot disagree.
 *
 * WITH NOBODY ONLINE it rotates over everyone instead of giving up. Out of
 * hours the choice is between an owner who will see it in the morning and no
 * owner at all, and a name on the thread is the more useful of the two — it
 * is also what a human dispatcher would do.
 */

export interface RotationMember {
  userId: string;
  online: boolean;
  /**
   * Conversations they already hold that are not closed. Read by
   * `least_busy` and by the ceiling; absent counts as zero, which is what
   * a caller that did not ask for either of those wants.
   */
  openCount?: number;
}

/**
 * The account's answers, from migration 051. Every field is optional and
 * every default is what the engine did before that migration existed, so
 * `nextInRotation(members, cursor)` behaves identically to the version
 * this replaces — which is what the eleven tests around it assert.
 */
export interface RotationRules {
  strategy?: 'round_robin' | 'least_busy' | 'best_score';
  /** userId → 0-100, only present for `best_score`. Absent means every
   *  candidate is treated as mid-table, which makes the mode behave
   *  exactly like round-robin — the right failure. */
  scores?: Map<string, number>;
  offlineFallback?: 'rotate_all' | 'leave_unassigned';
  /** Skip anybody already holding this many. 0 / undefined = no ceiling. */
  maxOpen?: number;
}

/**
 * Whose turn it is.
 *
 * Pure, and separate from every database call, because the interesting
 * behaviour is entirely in this decision and it deserves to be testable
 * without a Supabase double.
 *
 * The cursor is the previous winner, NOT an index: members join and leave,
 * and an index into a list that changed length silently starts handing three
 * conversations in a row to the same person. Resuming "after whoever got the
 * last one" survives the list changing under it, and degrades to "start from
 * the top" when that person is gone — which is correct rather than merely
 * safe.
 */
export function nextInRotation(
  members: RotationMember[],
  cursor: string | null | undefined,
  rules: RotationRules = {}
): string | null {
  if (members.length === 0) return null;

  // Online members are the rotation. Everyone is the fallback rotation —
  // unless the account said it would rather leave the thread in the
  // queue, which is the right answer for a team that watches the
  // unassigned tab and the wrong one for a team that does not.
  const online = members.filter((m) => m.online);
  if (online.length === 0 && rules.offlineFallback === 'leave_unassigned') {
    return null;
  }
  let pool = online.length > 0 ? online : members;

  // The ceiling is a SKIP, never a refusal. If it would empty the pool,
  // it is ignored: a cap that can jam the queue on the one afternoon it
  // matters is worse than no cap at all.
  const cap = rules.maxOpen ?? 0;
  if (cap > 0) {
    const under = pool.filter((m) => (m.openCount ?? 0) < cap);
    if (under.length > 0) pool = under;
  }

  // Fewest open conversations wins. Ties fall through to the rotation
  // below rather than to the array order — otherwise a quiet morning,
  // where everybody is on zero, hands every thread to the same person.
  if (rules.strategy === 'least_busy') {
    const lowest = Math.min(...pool.map((m) => m.openCount ?? 0));
    pool = pool.filter((m) => (m.openCount ?? 0) === lowest);
  }

  /**
   * Best score wins — and TIES FALL THROUGH TO THE ROTATION, which is
   * the line that keeps this from being unfair.
   *
   * A pure ranking sends every conversation to the top person until
   * their queue is the only full one, and the second-best never gets
   * the work that would let them improve. Scores are rounded to whole
   * points, so "equally good" is a real category and everybody in it
   * takes turns.
   *
   * Somebody with NO score yet — a new hire, or a quiet week — is
   * treated as mid-table rather than last. Ranking them bottom would
   * mean never sending them the conversation that would give them a
   * score, and the router would keep that true forever.
   */
  if (rules.strategy === 'best_score') {
    const scoreOf = (userId: string) => rules.scores?.get(userId) ?? 50;
    const best = Math.max(...pool.map((m) => scoreOf(m.userId)));
    pool = pool.filter((m) => scoreOf(m.userId) === best);
  }

  const at = cursor ? pool.findIndex((m) => m.userId === cursor) : -1;

  // `at === -1` covers three real cases at once — no cursor yet, the last
  // recipient has left the account, and the last recipient is offline while
  // others are online — and the answer to all three is the same: start at
  // the top.
  return pool[(at + 1) % pool.length].userId;
}

/** How long after `last_seen_at` a member stops counting as available. */
const PRESENCE_FRESHNESS_MS = 5 * 60 * 1000;

interface AutoAssignResult {
  /** Who got it, or null when nothing was assigned. */
  assignedTo: string | null;
  reason:
    'assigned' | 'disabled' | 'already-assigned' | 'no-members' | 'unavailable';
}

/**
 * Assign one conversation, if the account asked for that.
 *
 * NEVER REASSIGNS. `currentAssignee` short-circuits the whole thing: taking
 * a thread away from the person already handling it — because the customer
 * sent another message — would be the single most destructive thing an
 * automatic router could do.
 *
 * Best-effort throughout. This runs inside inbound webhook processing, where
 * throwing means Meta redelivers the message and everything downstream runs
 * twice; an unassigned conversation is a much smaller problem than a
 * duplicated one.
 */
export async function autoAssignConversation(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    currentAssignee: string | null | undefined;
    now?: number;
  }
): Promise<AutoAssignResult> {
  try {
    return await assign(db, args);
  } catch (error) {
    // "Best-effort" has to be enforced, not just intended. This runs inside
    // inbound webhook processing: anything thrown here aborts the rest of
    // the message — flow dispatch, automations, the opt-out write — and
    // makes Meta redeliver, so the whole thing runs again. An unassigned
    // conversation is a far smaller problem than a duplicated one.
    console.error(
      '[auto-assign] skipped:',
      error instanceof Error ? error.message : error
    );
    return { assignedTo: null, reason: 'unavailable' };
  }
}

async function assign(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    currentAssignee: string | null | undefined;
    now?: number;
  }
): Promise<AutoAssignResult> {
  if (args.currentAssignee)
    return { assignedTo: null, reason: 'already-assigned' };

  const rules = await loadRules(db, args.accountId);
  if (!rules) return { assignedTo: null, reason: 'disabled' };

  // `auto_assign_min_role` and `auto_assign_opt_out` arrive with 051. On a
  // database without them the SELECT is a 42703 for the whole row, so the
  // narrow one runs instead and every member stays eligible — which is
  // precisely the pre-051 behaviour.
  type ProfileRow = {
    user_id: string | null;
    account_role?: string | null;
    auto_assign_opt_out?: boolean | null;
  };

  const wideProfiles = await db
    .from('profiles')
    .select('user_id, account_role, auto_assign_opt_out')
    .eq('account_id', args.accountId);

  let profiles = (wideProfiles.data ?? []) as ProfileRow[];
  if (wideProfiles.error && isUnknownColumn(wideProfiles.error)) {
    const narrow = await db
      .from('profiles')
      .select('user_id, account_role')
      .eq('account_id', args.accountId);
    profiles = (narrow.data ?? []) as ProfileRow[];
  }

  const { data: presence } = await db
    .from('member_presence')
    .select('user_id, status, last_seen_at')
    .eq('account_id', args.accountId);

  if (profiles.length === 0) {
    return { assignedTo: null, reason: 'no-members' };
  }

  const now = args.now ?? Date.now();
  const seen = new Map(
    (presence ?? []).map((row) => [
      row.user_id as string,
      row as { status: string; last_seen_at: string },
    ])
  );

  // Who is even in the rotation.
  //
  // The role floor is the fix for a confirmed defect, not a preference: a
  // `viewer` is read-only across the whole product — the composer is
  // disabled for them — so handing them a thread files a waiting customer
  // under an owner who cannot answer, and takes it out of the unassigned
  // queue where a colleague would have found it. 051 defaults the floor to
  // `agent`; before 051, `account_role` is still read and the floor
  // defaults to the same thing here, so the fix does not wait on the
  // migration.
  const minRole: AccountRole = rules.minRole;
  const eligible = profiles.filter((p) => {
    if (!p.user_id) return false;
    if (p.auto_assign_opt_out) return false;
    const role = isAccountRole(p.account_role) ? p.account_role : null;
    // An unreadable role is not a licence. Skipping is the conservative
    // direction: the thread stays in the queue rather than going to
    // somebody who may not be able to act on it.
    return !!role && hasMinRole(role, minRole);
  });

  if (eligible.length === 0) {
    return { assignedTo: null, reason: 'no-members' };
  }

  // Only paid for when something asks. `least_busy` needs every count;
  // the ceiling needs them too. Plain round-robin with no cap needs none,
  // and this is the inbound webhook.
  const openCounts =
    rules.strategy === 'least_busy' || rules.maxOpen > 0
      ? await loadOpenCounts(db, args.accountId)
      : null;

  const members: RotationMember[] = eligible
    .filter((p) => !!p.user_id)
    .map((p) => {
      const row = seen.get(p.user_id as string);
      const status = derivePresence(
        row?.status as 'online' | 'away' | undefined,
        row?.last_seen_at,
        now
      );
      // `away` is still at the desk — the browser is open, the tab is not
      // focused. Only `offline` is out of the rotation, and the extra
      // freshness check catches a row left behind by a tab that was closed
      // without ever reporting.
      const fresh =
        !!row?.last_seen_at &&
        now - new Date(row.last_seen_at).getTime() < PRESENCE_FRESHNESS_MS;
      return {
        userId: p.user_id as string,
        online: status !== 'offline' && fresh,
        openCount: openCounts?.get(p.user_id as string) ?? 0,
      };
    });

  const winner = nextInRotation(members, rules.cursor, {
    strategy: rules.strategy,
    offlineFallback: rules.offlineFallback,
    maxOpen: rules.maxOpen,
  });
  if (!winner) return { assignedTo: null, reason: 'unavailable' };

  const { error: assignError } = await db
    .from('conversations')
    .update({ assigned_agent_id: winner, updated_at: new Date().toISOString() })
    .eq('id', args.conversationId)
    // Re-checked in SQL: a human may have claimed the thread between our
    // read and this write, and the machine must lose that race.
    .is('assigned_agent_id', null);

  if (assignError) {
    console.error('[auto-assign] could not assign:', assignError.message);
    return { assignedTo: null, reason: 'unavailable' };
  }

  // Advance the cursor even if the assignment above lost its race — the
  // alternative is that a contested thread makes the next one go to the same
  // person twice.
  const { error: cursorError } = await db
    .from('accounts')
    .update({ auto_assign_cursor: winner })
    .eq('id', args.accountId);
  if (cursorError && !isUnknownColumn(cursorError)) {
    console.error('[auto-assign] cursor not advanced:', cursorError.message);
  }

  return { assignedTo: winner, reason: 'assigned' };
}

// ------------------------------------------------------------------
// Reading the account's answers
// ------------------------------------------------------------------

interface LoadedRules {
  strategy: 'round_robin' | 'least_busy' | 'best_score';
  offlineFallback: 'rotate_all' | 'leave_unassigned';
  maxOpen: number;
  minRole: AccountRole;
  cursor: string | null;
  /**
   * userId → 0-100, only loaded for `best_score`.
   *
   * Computed at read time from messages and conversations — see
   * `lib/team/performance.ts` for why it is never a stored column.
   */
  scores?: Map<string, number>;
}

/**
 * The account's assignment rules, or null when it has not asked for any.
 *
 * TWO SELECTS, and the narrow one is not a fallback for an error — it is
 * the fallback for a schema. Migrations here are applied by hand, so
 * there is a real window where this file knows about four columns the
 * database does not, and naming one of them is a 42703 for the whole row.
 * That would read as "auto-assignment is off" and quietly stop routing
 * conversations for an account that had it on.
 *
 * Every default below is what the engine did before 051 — except
 * `minRole`, which is `agent` either way. See the note at the filter.
 */
async function loadRules(
  db: SupabaseClient,
  accountId: string
): Promise<LoadedRules | null> {
  const wide = await db
    .from('accounts')
    .select(
      'auto_assign_mode, auto_assign_cursor, auto_assign_min_role, auto_assign_offline_fallback, auto_assign_max_open'
    )
    .eq('id', accountId)
    .maybeSingle();

  let row = wide.data as Record<string, unknown> | null;

  if (wide.error && isUnknownColumn(wide.error)) {
    const narrow = await db
      .from('accounts')
      .select('auto_assign_mode, auto_assign_cursor')
      .eq('id', accountId)
      .maybeSingle();
    if (narrow.error || !narrow.data) return null;
    row = narrow.data as Record<string, unknown>;
  } else if (wide.error || !row) {
    // Pre-045 the columns do not exist at all, which reads exactly like
    // "this account has not turned the feature on" — the correct
    // behaviour, so it is not even an error path.
    return null;
  }

  const mode = row.auto_assign_mode;
  if (
    mode !== 'round_robin' &&
    mode !== 'least_busy' &&
    mode !== 'best_score'
  ) {
    return null;
  }

  const fallback = row.auto_assign_offline_fallback;
  const maxOpen = Number(row.auto_assign_max_open);
  const minRole = row.auto_assign_min_role;

  /**
   * Scores are loaded ONLY for the mode that reads them.
   *
   * It is the most expensive thing in this file — a month of messages
   * plus every assigned conversation — and it runs inside inbound
   * webhook processing. Paying for it on an account using round-robin
   * would be paying for an answer nobody asked for.
   *
   * A failure here degrades to "everybody is mid-table", which makes
   * `best_score` behave exactly like round-robin. That is the right
   * failure: assignment keeps working, just without the preference.
   */
  let scores: Map<string, number> | undefined;
  if (mode === 'best_score') {
    try {
      // The last 30 days, which is what the default argument used to
      // mean before the loader started taking explicit bounds. Routing
      // is about who is performing NOW, so this window always ends now.
      const perf = await loadTeamPerformance(db, accountId, {
        from: new Date(Date.now() - 30 * 86_400_000),
        to: new Date(),
      });
      scores = new Map(
        perf
          .filter((p) => p.score !== null)
          .map((p) => [p.userId, p.score as number])
      );
    } catch (err) {
      console.error('[auto-assign] score load failed, falling back:', err);
    }
  }

  return {
    strategy: mode,
    offlineFallback:
      fallback === 'leave_unassigned' ? 'leave_unassigned' : 'rotate_all',
    maxOpen: Number.isFinite(maxOpen) && maxOpen > 0 ? Math.floor(maxOpen) : 0,
    minRole: isAccountRole(minRole) ? minRole : 'agent',
    cursor: (row.auto_assign_cursor as string | null) ?? null,
    scores,
  };
}

/**
 * Open conversations per assignee.
 *
 * One query for the account rather than one per member, and only when
 * something is going to read it — see the call site. `closed` is the only
 * status that means "done"; `pending` is a thread parked for a reply and
 * very much still somebody's work.
 *
 * The rows are counted in JS rather than with a `group by`, because
 * PostgREST has no grouping and the alternative is one HEAD request per
 * member. An account with thousands of open conversations pays for a list
 * of ids here; that is the trade, and it is bounded by the same RLS as
 * everything else.
 */
async function loadOpenCounts(
  db: SupabaseClient,
  accountId: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('account_id', accountId)
    .neq('status', 'closed')
    .not('assigned_agent_id', 'is', null);

  if (error || !data) return counts;

  for (const row of data as Array<{ assigned_agent_id: string | null }>) {
    const id = row.assigned_agent_id;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
