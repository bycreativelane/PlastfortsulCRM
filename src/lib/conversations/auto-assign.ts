import type { SupabaseClient } from '@supabase/supabase-js';

import { derivePresence } from '@/lib/presence';
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
  cursor: string | null | undefined
): string | null {
  if (members.length === 0) return null;

  // Online members are the rotation. Everyone is the fallback rotation.
  const online = members.filter((m) => m.online);
  const pool = online.length > 0 ? online : members;

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

  const { data: account, error: accountError } = await db
    .from('accounts')
    .select('auto_assign_mode, auto_assign_cursor')
    .eq('id', args.accountId)
    .maybeSingle();

  // Pre-045 the columns do not exist, which reads exactly like "this account
  // has not turned the feature on" — and that is the correct behaviour, so
  // it is not even an error path.
  if (accountError || !account) return { assignedTo: null, reason: 'disabled' };
  if (account.auto_assign_mode !== 'round_robin') {
    return { assignedTo: null, reason: 'disabled' };
  }

  const [{ data: profiles }, { data: presence }] = await Promise.all([
    db.from('profiles').select('user_id').eq('account_id', args.accountId),
    db
      .from('member_presence')
      .select('user_id, status, last_seen_at')
      .eq('account_id', args.accountId),
  ]);

  if (!profiles || profiles.length === 0) {
    return { assignedTo: null, reason: 'no-members' };
  }

  const now = args.now ?? Date.now();
  const seen = new Map(
    (presence ?? []).map((row) => [
      row.user_id as string,
      row as { status: string; last_seen_at: string },
    ])
  );

  const members: RotationMember[] = profiles
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
      };
    });

  const winner = nextInRotation(members, account.auto_assign_cursor);
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
