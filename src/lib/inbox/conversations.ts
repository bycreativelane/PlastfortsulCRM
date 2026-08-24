import type { Conversation, ConversationDeal, Contact, Tag } from '@/types';

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 *
 * `deals(...)` is a reverse embed on `deals.conversation_id`, and carries the
 * stage's name and colour so a row can show which stage the negotiation is in
 * without a second query per conversation. Only the columns the row actually
 * paints are selected — a deal has a dozen more, and the inbox loads every
 * conversation at once.
 */
/* prettier-ignore — must stay ONE string literal: supabase-js parses the select
 * at the type level, and a concatenated string widens to `string`, which makes
 * every query built from it return GenericStringError instead of rows. */
export const CONVERSATION_SELECT =
  '*, contact:contacts(*, contact_tags(tags(*)), deals(id, status, stage_id, pipeline_id, stage:pipeline_stages(id, name, color, pipeline:pipelines(name))))';

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & {
  contact_tags?: { tags: Tag | null }[];
  deals?: ConversationDeal[] | null;
};
type RawConversation = Omit<Conversation, 'contact' | 'deal'> & {
  contact?: RawContact | null;
};

/**
 * The deal worth showing on a conversation row.
 *
 * An open one always wins: a won or lost deal describes a negotiation that is
 * over, and labelling today's thread with last quarter's outcome is worse than
 * showing no stage at all. With several open, the last one in the array wins —
 * PostgREST returns them in insertion order, so that is the newest.
 *
 * THE DEALS COME THROUGH THE CONTACT, not through `deals.conversation_id`.
 *
 * That column is only set when the deal was created FROM a thread; one
 * created on the board — which is most of them — leaves it null. Embedding on
 * it meant the stage chip was blank for exactly the deals somebody had been
 * managing on the Kanban, and blank is indistinguishable from "no
 * opportunity". Measured against the seeded account: every conversation came
 * back `deals: []` while every contact had one.
 *
 * Through the contact it is unambiguous — migration 036 put a UNIQUE index on
 * (account_id, contact_id) for conversations, so a contact has at most one
 * thread and "this person's open deal" and "this thread's open deal" are the
 * same sentence.
 */
function pickDeal(deals: ConversationDeal[] | null | undefined) {
  if (!deals?.length) return null;
  const open = deals.filter((d) => d.status === 'open');
  return open.length ? open[open.length - 1] : null;
}

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const { contact: rawContact, ...rest } = raw;
  const deal = pickDeal(rawContact?.deals);

  // A contactless row keeps whatever `contact` it arrived with — including an
  // explicit null. Consumers reach for it with `?.` either way, but the two
  // are not interchangeable to a caller checking `'contact' in conv`, and this
  // function has never been the place that decides.
  if (!rawContact) {
    return { ...rest, contact: rawContact, deal } as Conversation;
  }

  // `deals` is destructured off for the same reason `contact_tags` is: it is
  // the raw embed, already read above, and it must not ride along onto the
  // contact object consumers treat as a row.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { contact_tags, deals: _deals, ...contact } = rawContact;
  return {
    ...rest,
    deal,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[]
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}
