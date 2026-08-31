import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  findStalled,
  handOver,
  presentMembers,
  type HandoverResult,
} from '@/lib/conversations/handover';
import { hasMinRole, type AccountRole } from '@/lib/auth/roles';

/**
 * One pass over every account that turned handover on.
 *
 * ------------------------------------------------------------------
 * IT RIDES THE CRON THAT ALREADY EXISTS
 * ------------------------------------------------------------------
 *
 * `/api/automations/cron` is already scheduled, already authenticated
 * with a timing-safe secret, and already runs often enough. A second
 * scheduled endpoint would be a second secret to rotate, a second thing
 * to notice has stopped, and a second place to look when something did
 * not happen.
 *
 * ------------------------------------------------------------------
 * ACCOUNTS THAT DID NOT ASK FOR IT COST ONE COLUMN READ
 * ------------------------------------------------------------------
 *
 * `auto_reassign_after_minutes` is 0 by default, and 0 exits before any
 * other query. On an installation where nobody wants this, the sweep is
 * one SELECT over `accounts` per tick and nothing else.
 */
export async function sweepStalledConversations(): Promise<{
  scanned: number;
  handed: HandoverResult[];
}> {
  const db = supabaseAdmin();
  const handed: HandoverResult[] = [];

  const { data: accounts, error } = await db
    .from('accounts')
    .select('id, auto_reassign_after_minutes, auto_assign_cursor')
    .gt('auto_reassign_after_minutes', 0);

  // Pre-060 the column does not exist, and the feature simply is not
  // there yet. Not an error path — the same shape every reader in this
  // codebase uses for a migration that has not been applied.
  if (error || !accounts?.length) return { scanned: 0, handed };

  for (const row of accounts as {
    id: string;
    auto_reassign_after_minutes: number;
    auto_assign_cursor: string | null;
  }[]) {
    const minutes = row.auto_reassign_after_minutes;

    try {
      const stalled = await findStalled(db, row.id, minutes);
      if (stalled.length === 0) continue;

      // Loaded once per account, not once per conversation: on a bad
      // morning the same five people are the answer twenty times.
      const present = await presentMembers(db, row.id, minutes);
      if (present.size === 0) continue;

      const { data: profiles } = await db
        .from('profiles')
        .select('user_id, account_role')
        .eq('account_id', row.id);

      // The same floor the assignment path uses: a viewer cannot be
      // handed a conversation, because a viewer cannot reply to one.
      // Handing work to somebody who is not allowed to do it would be a
      // handover that guarantees the customer waits longer.
      const members = ((profiles ?? []) as {
        user_id: string;
        account_role: AccountRole | null;
      }[])
        .filter((p) => hasMinRole(p.account_role ?? 'viewer', 'agent'))
        .map((p) => ({ userId: p.user_id, online: present.has(p.user_id) }));

      if (members.length < 2) continue;

      // Open counts, once, so `least_busy` inside `handOver` has
      // something to read. Cheap: one list of ids for the account.
      const { data: open } = await db
        .from('conversations')
        .select('assigned_agent_id')
        .eq('account_id', row.id)
        .neq('status', 'closed')
        .not('assigned_agent_id', 'is', null);

      const counts = new Map<string, number>();
      for (const c of (open ?? []) as { assigned_agent_id: string }[]) {
        counts.set(
          c.assigned_agent_id,
          (counts.get(c.assigned_agent_id) ?? 0) + 1
        );
      }
      const withCounts = members.map((m) => ({
        ...m,
        openCount: counts.get(m.userId) ?? 0,
      }));

      for (const candidate of stalled) {
        const result = await handOver(
          db,
          candidate,
          present,
          withCounts,
          row.auto_assign_cursor
        );
        if (result) {
          handed.push(result);
          // The count moves with the handover so a second stalled
          // conversation in the same pass does not go to the same
          // person again — `least_busy` reading a stale count would
          // dump the whole backlog on one desk.
          const target = withCounts.find((m) => m.userId === result.to);
          if (target) target.openCount += 1;
        }
      }
    } catch (err) {
      // One account's failure must not stop the others.
      console.error(`[handover sweep] account ${row.id} failed:`, err);
    }
  }

  return { scanned: accounts.length, handed };
}
