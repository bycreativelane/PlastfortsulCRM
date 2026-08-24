import type { Conversation } from '@/types';

/**
 * The twelve names that answer "what KIND of contact is this".
 *
 * The prototype's data model has two separate fields - one `tipo`, single
 * valued, from a controlled vocabulary, and a free `etiquetas` array - and
 * only `tipo` reaches the conversation row and the filter menu. This app has
 * one flat `tags` table with no group column, so the vocabulary has to live
 * somewhere; a constant is the only place it can live without a migration.
 *
 * Matched by NAME, lower-cased and trimmed, because tag ids are per account
 * and this code has to work against any of them - the same normalisation
 * `resolve-import-tags.ts` already uses.
 *
 * Source: the block under `// Tipo de contato` in
 * `scripts/seed-plastfortsul.mjs`, which is spec section 5.
 */
const CONTACT_TYPE_NAMES = [
  'Lead',
  'Cliente',
  'Funcionário',
  'Transportadora',
  'Fornecedor',
  'Prestador de Serviço',
  'Banco',
  'Factoring',
  'Contabilidade',
  'Candidato',
  'Parceiro',
  'Outro',
] as const;

const norm = (v: string) => v.trim().toLowerCase();

const CONTACT_TYPE_SET = new Set<string>(CONTACT_TYPE_NAMES.map(norm));

/** The two the interface sorts by. Everything else folds into one bucket. */
const PRIMARY_TYPES = new Set([norm('Lead'), norm('Cliente')]);

/**
 * The tag this warning used to be read from, kept only as a fallback.
 *
 * The plan was that `Possui Ocorrência` would be the one automatic tag
 * section 16 allows, standing in until `contact_occurrences` landed. What
 * actually happened is that the table landed, the dialog wrote rows into it,
 * and NOTHING ever wrote the tag — so registering an occurrence produced no
 * triangle, no sidebar warning and no filter match. Two sources of truth,
 * one of them never written.
 *
 * `occurrence_count` (migration 042, maintained by trigger) is the source of
 * truth now. The tag survives here for accounts that applied it by hand
 * before the table existed, and for nothing else — do not write it.
 */
export const OCCURRENCE_TAG_NAME = 'Possui Ocorrência';

/** The contact's TYPE tag, or null - never a product or automatic tag. */
export function typeTagOf(
  c: Conversation
): { id: string; name: string; color: string } | null {
  for (const tag of c.contact?.tags ?? []) {
    if (CONTACT_TYPE_SET.has(norm(tag.name))) return tag;
  }
  return null;
}

/** Whether this contact has ever had a problem on record. */
export function hasOccurrence(c: Conversation): boolean {
  return contactHasOccurrence(c.contact);
}

/**
 * The same question, asked of a contact rather than a conversation — the
 * sidebar and the contacts table have one but not the other.
 *
 * Counter first, tag second. The counter is written by a trigger on every
 * insert, so it cannot drift; the tag is only ever right by coincidence.
 * Reading both means an account that pre-dates migration 042 keeps its
 * warning, and every account gets the warning the moment an occurrence is
 * actually registered.
 */
export function contactHasOccurrence(
  contact:
    | { occurrence_count?: number; tags?: Array<{ name: string }> }
    | null
    | undefined
): boolean {
  if ((contact?.occurrence_count ?? 0) > 0) return true;
  return (contact?.tags ?? []).some(
    (t) => norm(t.name) === norm(OCCURRENCE_TAG_NAME)
  );
}

/**
 * The inbox's two-level filter model.
 *
 * Level one is the SCOPE, and it is the only split that stays on screen. It
 * is the conversation's STATE — where the thread itself stands — because
 * that is the axis that changes what you do next: answer it, wait on it, or
 * leave it alone.
 *
 * IT USED TO BE OWNERSHIP, and that was the bug. `entrada` was
 * `!!assigned_agent_id` and `esperando` was its negation, so the tab called
 * Esperando meant "nobody claimed this". Meanwhile the thread header offered
 * a status called `pending` which `pt-BR.json` also translates to
 * "Esperando". Two controls, one word, no relationship between them.
 *
 * And ESPERANDO MEANS THE CUSTOMER IS WAITING — not that a thread is
 * unclaimed, and not that an agent parked it. A message from them puts it
 * there; a reply from us takes it out. See `@/lib/conversations/reopen`,
 * which owns that rule and records how it was misread once.
 *
 * So the scope reads `status`, the field both controls were already writing,
 * and ownership drops to where it belongs — a filter in the menu, one line
 * down. In a shared mailbox "who has this" is a real question; it is just
 * not the same question as "is this thread finished".
 *
 * Scope and filter combine with AND, never OR. "Esperando" + "Sem
 * responsável" means parked AND unclaimed, which is a real thing to ask for;
 * the union of those two sets is not.
 */

export type Scope = 'entrada' | 'esperando';

export const SCOPES: Record<Scope, (c: Conversation) => boolean> = {
  /** Answered. Somebody has replied and is carrying the conversation. */
  entrada: (c) => c.status === 'open',
  /**
   * The customer is waiting for us. Set automatically the moment they
   * write, cleared the moment an agent replies — see
   * `@/lib/conversations/reopen`. This is the amber one, and it is the only
   * tab where time passing is itself the problem.
   */
  esperando: (c) => c.status === 'pending',
};

/**
 * TWO TABS, NOT THREE.
 *
 * A `finalizados` scope was here briefly and has been removed: nobody asked
 * for it, and it was the wrong shape anyway. The bar answers "what needs me
 * now" — a finished conversation is by definition not that, so it was a
 * permanent third of the width spent on the one state that never needs
 * looking at. Encerradas is a FILTER, which is where it was before and where
 * it is again.
 */

/**
 * Hidden conversations are not in any scope.
 *
 * Filtered before the scopes rather than inside each one, so "hidden" cannot
 * accidentally mean three different things in three tabs, and so the tab
 * counts agree with the rows underneath them.
 */
export function isVisible(c: Conversation): boolean {
  return !c.hidden_at;
}

export interface FilterOption {
  id: string;
  /** Heading this option sits under in the menu. */
  group: string;
  label: string;
  match: (c: Conversation) => boolean;
  /**
   * This option REPLACES the current tab instead of narrowing it.
   *
   * Encerradas and Ocultas are the only two, and they have to be marked
   * because their counts cannot be measured the way every other option's
   * is. See `withCounts`.
   */
  replacesScope?: boolean;
}

/**
 * Build the menu.
 *
 * MOSTLY CURATED, and that is the change that matters. Two groups used to be
 * generated one row per distinct value - one per tag in the database, one per
 * company with a live conversation - so the menu grew with the data. With
 * eight conversations carrying eight companies, EMPRESA was one filter per
 * row in the list, and ETIQUETA was ten rows that move every time somebody
 * adds a tag in Settings: twenty-three options in a 240px scroller, most of
 * them matching exactly one conversation.
 *
 * What replaces them is what the prototype offers and what the spec lists:
 * four fixed contact-type buckets, the pipeline, and the stage. The company
 * is gone entirely - it is a search term, not an axis, and `matchesSearch`
 * already covers it.
 *
 * Pipeline and Etapa ARE still derived, because that vocabulary belongs to
 * the account rather than to us, but they are bounded by the funnel - two
 * pipelines and the stages they define, not one row per contact.
 *
 * What this still does NOT do is drop an option that yields zero within the
 * current scope - see `withCounts`: that one is disabled, not removed,
 * because a filter that vanishes when it would be empty teaches you to
 * distrust the menu.
 */
export function buildFilterOptions(
  conversations: Conversation[],
  pipelines: Array<{ id: string; name: string }>,
  currentUserId: string | null,
  labels: {
    groupOwner: string;
    groupState: string;
    groupType: string;
    groupPipeline: string;
    groupStage: string;
    mine: string;
    unassigned: string;
    unread: string;
    withAutomation: string;
    withOccurrence: string;
    closed: string;
    hidden: string;
    typeLead: string;
    typeCustomer: string;
    typeInternal: string;
    typeNone: string;
  }
): FilterOption[] {
  const options: FilterOption[] = [];

  if (currentUserId) {
    options.push({
      id: 'mine',
      group: labels.groupOwner,
      label: labels.mine,
      match: (c) => c.assigned_agent_id === currentUserId,
    });
  }

  // The other half of the ownership question, and the reason it can leave
  // the tab bar without being lost: "nobody has this" is still one click
  // away, inside whichever state you are looking at. It is a better filter
  // than it was a tab — as a tab it could only ever mean "unclaimed across
  // everything", and unclaimed-and-finished is not work.
  options.push({
    id: 'unassigned',
    group: labels.groupOwner,
    label: labels.unassigned,
    match: (c) => !c.assigned_agent_id,
  });

  options.push(
    {
      id: 'unread',
      group: labels.groupState,
      label: labels.unread,
      match: (c) => c.unread_count > 0,
    },
    {
      id: 'ai',
      group: labels.groupState,
      label: labels.withAutomation,
      // The bot is answering here — worth being able to isolate, because
      // these are the threads a human has NOT looked at by design.
      match: (c) => !c.ai_autoreply_disabled && (c.ai_reply_count ?? 0) > 0,
    },
    {
      id: 'occurrence',
      group: labels.groupState,
      label: labels.withOccurrence,
      // Under SITUAÇÃO rather than under the type group, which is where the
      // prototype puts it too: "has a problem on record" is a state of the
      // relationship, not a kind of contact.
      match: hasOccurrence,
    }
  );

  // The two options that reach OUTSIDE the current tab rather than narrowing
  // it. Everything above answers "of the conversations in front of me,
  // which"; these two answer "and what about the ones that are not".
  //
  // Encerradas is here rather than in the tab bar — see the note on SCOPES.
  // Ocultas is what makes hiding safe to offer at all: a row you cannot get
  // back is a row nobody dares put away.
  options.push(
    {
      id: 'closed',
      group: labels.groupState,
      label: labels.closed,
      match: (c) => c.status === 'closed',
      replacesScope: true,
    },
    {
      id: 'hidden',
      group: labels.groupState,
      label: labels.hidden,
      match: (c) => !!c.hidden_at,
      replacesScope: true,
    }
  );

  // Four buckets, fixed, whatever the tag table grows to. Lead and Cliente
  // are the two anyone sorts by; the other ten types are one decision - "is
  // this a customer, or is this the rest of the company's life" - which is
  // the fold the prototype makes as well.
  options.push(
    {
      id: 'type:lead',
      group: labels.groupType,
      label: labels.typeLead,
      match: (c) => norm(typeTagOf(c)?.name ?? '') === norm('Lead'),
    },
    {
      id: 'type:customer',
      group: labels.groupType,
      label: labels.typeCustomer,
      match: (c) => norm(typeTagOf(c)?.name ?? '') === norm('Cliente'),
    },
    {
      id: 'type:internal',
      group: labels.groupType,
      label: labels.typeInternal,
      match: (c) => {
        const name = norm(typeTagOf(c)?.name ?? '');
        return !!name && !PRIMARY_TYPES.has(name);
      },
    },
    {
      id: 'type:none',
      group: labels.groupType,
      label: labels.typeNone,
      // The one that earns its place twice over: an unclassified contact is
      // work somebody has to do, and it is invisible without this row.
      match: (c) => !typeTagOf(c),
    }
  );

  // Bounded by the funnel rather than by the contact base.
  for (const pipeline of pipelines) {
    options.push({
      id: `pipeline:${pipeline.id}`,
      group: labels.groupPipeline,
      label: pipeline.name,
      match: (c) => c.deal?.pipeline_id === pipeline.id,
    });
  }

  const stages = new Map<string, string>();
  for (const c of conversations) {
    const stage = c.deal?.stage;
    if (stage) stages.set(stage.id, stage.name);
  }
  for (const [id, name] of stages) {
    options.push({
      id: `stage:${id}`,
      group: labels.groupStage,
      label: name,
      match: (c) => c.deal?.stage?.id === id,
    });
  }

  return options;
}

/**
 * Attach each option's count, measured inside the current scope.
 *
 * This is the property that makes the menu worth opening: the number next to
 * an option is exactly how many rows you will see after clicking it. A count
 * measured across the whole inbox would be a promise the click cannot keep.
 */
export function withCounts(
  options: FilterOption[],
  inScope: Conversation[],
  /**
   * Everything the search matched, before the tab narrowed it.
   *
   * THE TWO SCOPE-REPLACING OPTIONS CANNOT BE COUNTED AGAINST `inScope`,
   * and counting them there was a bug that made both unclickable.
   *
   * Encerradas matches `status === 'closed'` and Ocultas matches
   * `hidden_at`; `inScope` is the current tab, which by construction holds
   * neither. So both counted zero in every tab, forever — and the menu
   * disables a zero-count row. The dependency was circular: reaching the
   * filter needed a count, and the count needed the filter.
   *
   * That took a finished conversation out of the inbox entirely once the
   * Finalizados TAB was removed, and it made "Ocultar" a one-way door,
   * contradicting the promise the hide action is sold on.
   */
  outsideScope: Conversation[] = inScope
): Array<FilterOption & { count: number }> {
  return options.map((option) => {
    const against = option.replacesScope ? outsideScope : inScope;
    return {
      ...option,
      count: against.reduce((n, c) => (option.match(c) ? n + 1 : n), 0),
    };
  });
}

/** Group options for rendering, preserving the order they were built in. */
export function groupOptions<T extends { group: string }>(
  options: T[]
): Array<[group: string, items: T[]]> {
  const groups = new Map<string, T[]>();
  for (const option of options) {
    const list = groups.get(option.group);
    if (list) list.push(option);
    else groups.set(option.group, [option]);
  }
  return Array.from(groups.entries());
}

/** Free-text search across the fields someone would actually type. */
export function matchesSearch(c: Conversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    c.contact?.name,
    c.contact?.phone,
    c.contact?.company,
    c.last_message_text,
  ].some((field) => field?.toLowerCase().includes(q));
}
