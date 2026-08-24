/**
 * `@` in the message field assigns the conversation.
 *
 * The affordance already exists as a chip in the header, so this is not the
 * only way to do it — it is the way for someone whose hands are already on the
 * keyboard, which is where an agent's hands are all day. Type `@an`, Enter,
 * the thread is Ana's, and the field never lost focus.
 *
 * Two decisions worth stating, because both were the other way round first:
 *
 * `@` ASSIGNS, it does not mention. Two meanings for one key in one field is
 * how somebody eventually sends "@ana" to a customer. There is no mention
 * feature to collide with, and there will not be one on this key.
 *
 * It only opens at the START of the field. Mid-sentence, `@` is an email
 * address or a handle the customer wrote, and a panel that springs open over
 * those is a panel people learn to fight.
 */

export interface AssignCandidate {
  /** `auth.users.id`, or null for the "leave it unassigned" row. */
  userId: string | null;
  label: string;
  /** Ordered first and labelled differently — it is the common case. */
  isSelf?: boolean;
  /** Ordered last. Returns the thread to the shared queue. */
  isUnassign?: boolean;
}

/**
 * Is the field currently in `@` mode, and what has been typed after it?
 *
 * Returns null when the panel should be closed. A space ends it: `@ana ` is
 * somebody who started typing a message, not somebody still choosing.
 */
export function assignQuery(text: string): string | null {
  if (!text.startsWith('@')) return null;
  const rest = text.slice(1);
  if (/\s/.test(rest)) return null;
  return rest;
}

/**
 * Candidates matching what has been typed, in the order they should appear.
 *
 * Matching is by WORD PREFIX, never a loose substring. `/pra` bringing back
 * "Compra Futura" is the kind of result that makes someone stop trusting a
 * list; the same applies here to `an` matching "Joana". Prefix matching over
 * each word means `an` finds "Ana" and "Ana Paula" and not "Joana".
 */
export function filterAssignCandidates(
  candidates: AssignCandidate[],
  query: string
): AssignCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((candidate) =>
    candidate.label
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(q))
  );
}

/**
 * Build the list: yourself first, teammates in the middle, unassign last.
 *
 * Self first because taking a conversation is what an agent does most often
 * with this key — handing one over is the rarer, more deliberate act. Unassign
 * last for the same reason in reverse: returning something to the queue should
 * take one more keystroke than claiming it.
 */
export function buildAssignCandidates(
  profiles: Array<{ user_id: string; full_name: string | null }>,
  currentUserId: string | null,
  labels: { takeIt: string; unassign: string; unnamed: string },
  assignedAgentId: string | null
): AssignCandidate[] {
  const out: AssignCandidate[] = [];

  if (currentUserId && assignedAgentId !== currentUserId) {
    out.push({ userId: currentUserId, label: labels.takeIt, isSelf: true });
  }

  for (const profile of profiles) {
    if (profile.user_id === currentUserId) continue;
    out.push({
      userId: profile.user_id,
      label: profile.full_name?.trim() || labels.unnamed,
    });
  }

  if (assignedAgentId) {
    out.push({ userId: null, label: labels.unassign, isUnassign: true });
  }

  return out;
}
