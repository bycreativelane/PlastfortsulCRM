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
 * The one automatic tag section 16 allows - "não usar uma etiqueta para cada
 * problema", but a single flag saying a problem EXISTS is exactly what the
 * row indicator needs. Until `contact_occurrences` lands this is the whole
 * source of truth for that warning; after it, it becomes the tag the
 * occurrence trigger writes rather than the fact itself.
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

/** Whether this contact carries the occurrence flag. */
export function hasOccurrence(c: Conversation): boolean {
  return (c.contact?.tags ?? []).some(
    (t) => norm(t.name) === norm(OCCURRENCE_TAG_NAME)
  );
}

/**
 * The inbox's two-level filter model.
 *
 * Level one is the SCOPE, and it is the only split that stays on screen:
 * conversations somebody owns, versus conversations sitting in the queue with
 * nobody on them. In a shared mailbox that is the difference between "my work"
 * and "work nobody has claimed", and it is the only distinction that changes
 * what you do next. Everything else is level two — behind the Filter menu,
 * invisible until asked for.
 *
 * The two combine with AND, never OR. "Esperando" + "Não lidas" means the ones
 * nobody picked up AND nobody read, which is a real question someone asks; the
 * union of those two sets is not.
 */

export type Scope = 'entrada' | 'esperando';

export const SCOPES: Record<Scope, (c: Conversation) => boolean> = {
  /** Somebody owns it — it is being handled. */
  entrada: (c) => !!c.assigned_agent_id,
  /** In the shared queue, unclaimed. This is the amber one. */
  esperando: (c) => !c.assigned_agent_id,
};

export interface FilterOption {
  id: string;
  /** Heading this option sits under in the menu. */
  group: string;
  label: string;
  match: (c: Conversation) => boolean;
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
    unread: string;
    withAutomation: string;
    withOccurrence: string;
    open: string;
    closed: string;
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

  options.push(
    {
      id: 'unread',
      group: labels.groupState,
      label: labels.unread,
      match: (c) => c.unread_count > 0,
    },
    {
      id: 'open',
      group: labels.groupState,
      label: labels.open,
      match: (c) => c.status === 'open',
    },
    {
      id: 'closed',
      group: labels.groupState,
      label: labels.closed,
      match: (c) => c.status === 'closed',
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
  inScope: Conversation[]
): Array<FilterOption & { count: number }> {
  return options.map((option) => ({
    ...option,
    count: inScope.reduce((n, c) => (option.match(c) ? n + 1 : n), 0),
  }));
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
