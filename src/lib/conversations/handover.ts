import type { SupabaseClient } from '@supabase/supabase-js';

import {
  nextInRotation,
  type RotationMember,
} from '@/lib/conversations/auto-assign';

/**
 * The customer is still waiting and whoever has it walked away.
 *
 * ------------------------------------------------------------------
 * THE THREE CONDITIONS, AND WHY ALL THREE
 * ------------------------------------------------------------------
 *
 * A conversation is handed over only when every one of these is true:
 *
 *   1. THE CUSTOMER IS WAITING — `status = 'pending'`, which the inbound
 *      webhook sets and a human reply clears. Not "assigned a while
 *      ago": somebody can hold a thread for a day with nobody waiting
 *      on them, and taking it away would be taking away their work.
 *
 *   2. THEY HAVE BEEN WAITING LONGER THAN THE THRESHOLD — measured from
 *      `waiting_since`, which is stamped at the FIRST unanswered
 *      message, so four messages in ten minutes is one ten-minute wait.
 *
 *   3. THE ASSIGNEE IS ACTUALLY GONE — `member_presence.last_seen_at`
 *      older than the same threshold. Somebody at their desk who has
 *      not got to it yet is busy, not absent, and moving their work is
 *      how a router picks a fight with the team.
 *
 * Miss condition 3 and this becomes "take conversations off whoever is
 * slowest", which is a very different feature and one nobody asked for.
 *
 * ------------------------------------------------------------------
 * NEVER TO SOMEBODY WHO IS ALSO AWAY
 * ------------------------------------------------------------------
 *
 * The whole point is that the customer gets an answer. Passing the
 * thread from one absent person to another absent person is motion
 * without progress, and it would reset the clock — so the same
 * conversation would bounce around the team all night, generating a
 * handover row each time, and still be unanswered in the morning.
 *
 * When nobody is available it is left where it is. A conversation
 * sitting with a named person is at least somebody's to answer; one
 * that has been passed to four absent people in an hour is nobody's.
 */

const PRESENCE_TABLE = 'member_presence';

export interface HandoverCandidate {
  conversationId: string;
  accountId: string;
  assignedTo: string;
  waitingSince: string;
}

export interface HandoverResult {
  conversationId: string;
  from: string;
  to: string;
  waitedMinutes: number;
}

/**
 * Who is present enough to receive work right now.
 *
 * Deliberately stricter than the assignment path's freshness window: a
 * handover is an interruption, and handing a thread to somebody who
 * closed their laptop two minutes ago just moves the problem.
 */
export async function presentMembers(
  db: SupabaseClient,
  accountId: string,
  thresholdMinutes: number
): Promise<Set<string>> {
  const cutoff = new Date(
    Date.now() - thresholdMinutes * 60_000
  ).toISOString();

  const { data } = await db
    .from(PRESENCE_TABLE)
    .select('user_id, status, last_seen_at')
    .eq('account_id', accountId)
    .gte('last_seen_at', cutoff);

  return new Set(
    ((data ?? []) as { user_id: string; status: string }[])
      // `away` is the tab saying so explicitly. Someone who marked
      // themselves away is telling us not to route to them, and that is
      // more reliable than a heartbeat from a browser left open.
      .filter((row) => row.status !== 'away')
      .map((row) => row.user_id)
  );
}

/**
 * Conversations that meet all three conditions.
 *
 * Reads only what the decision needs. The sweep runs on a schedule
 * across every account, so this is the query that has to stay cheap —
 * hence the partial index in migration 060.
 */
export async function findStalled(
  db: SupabaseClient,
  accountId: string,
  thresholdMinutes: number
): Promise<HandoverCandidate[]> {
  const cutoff = new Date(
    Date.now() - thresholdMinutes * 60_000
  ).toISOString();

  const { data, error } = await db
    .from('conversations')
    .select('id, account_id, assigned_agent_id, waiting_since, status, hidden_at')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .not('assigned_agent_id', 'is', null)
    .not('waiting_since', 'is', null)
    .lt('waiting_since', cutoff)
    // A hidden conversation was pushed out of the way on purpose.
    // Handing it to somebody would un-hide it by the back door.
    .is('hidden_at', null);

  if (error) return [];

  return ((data ?? []) as {
    id: string;
    account_id: string;
    assigned_agent_id: string;
    waiting_since: string;
  }[]).map((row) => ({
    conversationId: row.id,
    accountId: row.account_id,
    assignedTo: row.assigned_agent_id,
    waitingSince: row.waiting_since,
  }));
}

/**
 * Hand one conversation to the next available person.
 *
 * Returns null when nothing was done — no candidate, nobody present, or
 * the only person present is the one who already has it.
 *
 * NEVER THROWS: this runs inside a scheduled sweep over every account,
 * and one bad row must not stop the rest.
 */
export async function handOver(
  db: SupabaseClient,
  candidate: HandoverCandidate,
  present: Set<string>,
  members: RotationMember[],
  cursor: string | null
): Promise<HandoverResult | null> {
  try {
    // Everybody present EXCEPT the person who has it. Handing a thread
    // back to the same person would write a handover row that changed
    // nothing and reset the clock — so it would happen again in thirty
    // minutes, forever.
    const pool = members.filter(
      (m) => present.has(m.userId) && m.userId !== candidate.assignedTo
    );
    if (pool.length === 0) return null;

    // `least_busy`, not the account's own strategy. A handover is a
    // rescue, and the question is who can pick this up NOW — not who
    // scores best over thirty days. Sending a stalled conversation to
    // the person already holding the most is how one gets stalled again.
    const next = nextInRotation(pool, cursor, { strategy: 'least_busy' });
    if (!next || next === candidate.assignedTo) return null;

    const waitedMinutes = Math.max(
      0,
      Math.round(
        (Date.now() - new Date(candidate.waitingSince).getTime()) / 60_000
      )
    );

    // The conversation moves first. If the log write fails afterwards
    // the customer still gets an answer, which is the point; the
    // reverse order would risk a logged handover that never happened.
    const { error } = await db
      .from('conversations')
      .update({ assigned_agent_id: next, updated_at: new Date().toISOString() })
      .eq('id', candidate.conversationId)
      // Only if it is STILL with the same person. Somebody may have
      // picked it up in the seconds since the query — and taking it out
      // of the hands of a person who just started typing is the worst
      // thing this sweep could do.
      .eq('assigned_agent_id', candidate.assignedTo);

    if (error) return null;

    await db.from('conversation_handovers').insert({
      account_id: candidate.accountId,
      conversation_id: candidate.conversationId,
      from_user_id: candidate.assignedTo,
      to_user_id: next,
      reason: 'away',
      waited_minutes: waitedMinutes,
    });

    return {
      conversationId: candidate.conversationId,
      from: candidate.assignedTo,
      to: next,
      waitedMinutes,
    };
  } catch (err) {
    console.error('[handover] failed:', err);
    return null;
  }
}
