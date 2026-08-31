import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllPages } from '@/lib/supabase/paged';

/**
 * How each attendant is doing, and the score the router reads.
 *
 * ------------------------------------------------------------------
 * THE SCORE IS DERIVED, NEVER STORED
 * ------------------------------------------------------------------
 *
 * There is no `score` column anywhere. It is computed from messages and
 * conversations that already exist, on every read.
 *
 * Storing would be faster and would be wrong within the hour: a written
 * number ages in silence, and the first time routing sends everything
 * to whoever was good last week, nobody will know the column stopped
 * being updated. Computing costs one query per assignment and is always
 * true.
 *
 * ------------------------------------------------------------------
 * TWO NUMBERS, AND BOTH ARE SHOWN
 * ------------------------------------------------------------------
 *
 * A score somebody cannot decompose is a score nobody trusts — and this
 * one decides who gets work, so it will be argued with. It is a blend
 * of exactly two things, and every screen that shows the score shows
 * both parts beside it:
 *
 *   RESPONSE   median minutes from a customer's message to the reply
 *   RESOLUTION share of the conversations they held that got closed
 *
 * MEDIAN, NOT AVERAGE, and that is the difference between a number
 * that describes the work and one that describes the worst day of it.
 * One conversation answered on Monday morning after sitting all weekend
 * is 3,000 minutes; it drags an average of ten replies from four
 * minutes to three hundred. The median moves by one position.
 */

export interface AgentPerformance {
  userId: string;
  /** Replies counted — the sample the numbers rest on. */
  replies: number;
  /** Median minutes from the customer's message to this agent's reply. */
  medianResponseMinutes: number | null;
  /** Conversations this agent handled in the window. */
  handled: number;
  /** Of those, how many reached `closed`. */
  resolved: number;
  /** 0–1. `null` when nothing was handled. */
  resolutionRate: number | null;
  /** 0–100, higher is better. `null` when there is no sample. */
  score: number | null;
}

/**
 * A reply is only a "response" if the customer was waiting for it.
 *
 * An agent sending three messages in a row produces one response and
 * two follow-ups; counting all three would reward talking rather than
 * answering. So a reply counts only when the previous message in the
 * conversation came from the customer.
 */
interface MessageRow {
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  created_at: string;
}

export function responseTimesByAgent(
  messages: MessageRow[]
): Map<string, number[]> {
  const byConversation = new Map<string, MessageRow[]>();
  for (const m of messages) {
    (byConversation.get(m.conversation_id) ??
      byConversation.set(m.conversation_id, []).get(m.conversation_id)!).push(m);
  }

  const out = new Map<string, number[]>();

  for (const thread of byConversation.values()) {
    const ordered = [...thread].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // The customer message still waiting for an answer. Cleared as soon
    // as somebody replies, so a burst of four customer messages counts
    // ONCE, from the first — the wait started there, and crediting the
    // agent from the last one would make a slow reply to an impatient
    // customer look fast.
    let waitingSince: number | null = null;

    for (const m of ordered) {
      const at = new Date(m.created_at).getTime();

      if (m.sender_type === 'customer') {
        if (waitingSince === null) waitingSince = at;
        continue;
      }

      // Bot replies do not clear the wait and do not score. An
      // auto-reply saying "recebemos sua mensagem" has answered nobody
      // — the same rule `reopen.ts` applies to the Esperando queue.
      if (m.sender_type !== 'agent') continue;

      if (waitingSince !== null && m.sender_id) {
        const minutes = (at - waitingSince) / 60_000;
        // A negative gap means clocks disagreed or a row was
        // backfilled. Dropping it beats letting it pull a median.
        if (minutes >= 0) {
          (out.get(m.sender_id) ?? out.set(m.sender_id, []).get(m.sender_id)!).push(
            minutes
          );
        }
      }
      waitingSince = null;
    }
  }

  return out;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * The blend, 0–100.
 *
 * ------------------------------------------------------------------
 * WHY SPEED IS CAPPED AND NOT SCALED
 * ------------------------------------------------------------------
 *
 * Response time is scored against a target rather than against the
 * other agents. Scaling against peers means somebody always loses even
 * when the whole team is fast, and the ranking swings wildly on a quiet
 * day when one person handled two conversations.
 *
 * `TARGET_MINUTES` is what "answered promptly" means here; anything at
 * or under it scores full marks, and it decays from there. Two minutes
 * and four minutes are both simply good.
 *
 * ------------------------------------------------------------------
 * AND WHY RESOLUTION IS WORTH MORE THAN SPEED
 * ------------------------------------------------------------------
 *
 * 60/40 to resolution. A router that optimises purely for speed sends
 * every conversation to whoever answers fastest — and the fastest way
 * to answer is to say something, not to finish anything. Weighting the
 * outcome higher than the reflex is what stops the score rewarding the
 * behaviour it would otherwise create.
 */
const TARGET_MINUTES = 5;
const FLOOR_MINUTES = 120;
const RESOLUTION_WEIGHT = 0.6;
const RESPONSE_WEIGHT = 0.4;

export function scoreFor(
  medianResponseMinutes: number | null,
  resolutionRate: number | null
): number | null {
  if (medianResponseMinutes === null && resolutionRate === null) return null;

  // A missing half is treated as neutral rather than as zero: somebody
  // with replies but no closed conversation yet should not rank below
  // somebody with no data at all.
  const speed =
    medianResponseMinutes === null
      ? 0.5
      : medianResponseMinutes <= TARGET_MINUTES
        ? 1
        : Math.max(
            0,
            1 -
              (medianResponseMinutes - TARGET_MINUTES) /
                (FLOOR_MINUTES - TARGET_MINUTES)
          );

  const resolution = resolutionRate === null ? 0.5 : resolutionRate;

  return Math.round(
    (speed * RESPONSE_WEIGHT + resolution * RESOLUTION_WEIGHT) * 100
  );
}

/**
 * Everybody's numbers for a window.
 *
 * `days` is the window, and it matters more than it looks: too short
 * and the score is noise from one bad afternoon, too long and somebody
 * who improved a month ago is still paying for it. Thirty is the
 * default the screens use.
 */
export async function loadTeamPerformance(
  db: SupabaseClient,
  accountId: string,
  /**
   * The window, as two instants.
   *
   * It was a day count, which can only ever mean "ending now" — so with
   * the custom period on Relatórios, asking for July would have scored
   * the team on the last thirty-one days instead, and the number would
   * have looked entirely reasonable. A window with an explicit end is
   * the only shape that cannot quietly answer a different question.
   */
  window: { from: Date; to: Date }
): Promise<AgentPerformance[]> {
  const since = window.from.toISOString();
  const until = window.to.toISOString();

  /**
   * BOTH HALVES OF THE SCORE COVER THE SAME WINDOW.
   *
   * The conversation query had no date filter at all, so `handled` and
   * `closed` were lifetime totals while the response median was
   * windowed. Picking July and picking the last seven days produced the
   * same resolution rate, and the panel labelled the pair with whichever
   * period was on screen — a precise claim about numbers that ignored it.
   *
   * The cohort is conversations that STARTED in the window, which is
   * what a person means by "as conversas do período". It carries the
   * usual cohort bias: one opened on the last day has had no time to be
   * closed, so a window ending today reads slightly low. That is a known
   * and explainable shape. A lifetime number under a July heading is not.
   *
   * `closed_at` would allow the other definition — closed IN the window,
   * whenever they started — and the column does not exist.
   */
  const [conversations, rawMessages] = await Promise.all([
    fetchAllPages<{ id: string; assigned_agent_id: string; status: string }>(
      (from, to) =>
        db
          .from('conversations')
          .select('id, assigned_agent_id, status')
          .eq('account_id', accountId)
          .not('assigned_agent_id', 'is', null)
          .gte('created_at', since)
          .lt('created_at', until)
          // Ordered because `range()` is OFFSET/LIMIT — see the contract
          // on `fetchAllPages`. Unordered pages repeat and skip rows, and
          // these get counted.
          .order('created_at', { ascending: true })
          .range(from, to)
    ),
    fetchAllPages<MessageRow>((from, to) =>
      db
        .from('messages')
        .select('conversation_id, sender_type, sender_id, created_at')
        .gte('created_at', since)
        // Exclusive, like every other bound in the reporting layer.
        .lt('created_at', until)
        .order('created_at', { ascending: true })
        .range(from, to)
    ),
  ]);

  // Messages are not filtered by account in the query — `messages` has
  // no `account_id`, it inherits tenancy through the conversation. So
  // they are filtered HERE against the conversations we just authorised.
  const owned = new Set(conversations.map((c) => c.id));
  const messages = rawMessages.filter((m) => owned.has(m.conversation_id));

  const times = responseTimesByAgent(messages);

  const handled = new Map<string, { total: number; closed: number }>();
  for (const c of conversations) {
    const row = handled.get(c.assigned_agent_id) ?? { total: 0, closed: 0 };
    row.total += 1;
    if (c.status === 'closed') row.closed += 1;
    handled.set(c.assigned_agent_id, row);
  }

  const userIds = new Set([...times.keys(), ...handled.keys()]);

  return [...userIds].map((userId) => {
    const values = times.get(userId) ?? [];
    const counts = handled.get(userId) ?? { total: 0, closed: 0 };
    const medianResponse = median(values);
    const resolutionRate =
      counts.total > 0 ? counts.closed / counts.total : null;

    return {
      userId,
      replies: values.length,
      medianResponseMinutes: medianResponse,
      handled: counts.total,
      resolved: counts.closed,
      resolutionRate,
      score: scoreFor(medianResponse, resolutionRate),
    };
  });
}
