import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * What the assistant is allowed to look up mid-sentence.
 *
 * Until now it could only talk. Everything it knew came from the system
 * prompt and from whatever the retriever happened to pull, which means a
 * customer asking "quanto custa o saco de 100 litros" or "vocês já me
 * entregaram esse mês?" got either a guess from the knowledge base or an
 * apology — while the answer sat in a table two joins away.
 *
 * ------------------------------------------------------------------
 * THREE RULES, and they are what make this safe enough to ship.
 * ------------------------------------------------------------------
 *
 * 1. EVERY TOOL IS READ-ONLY. Nothing here writes, tags, moves a deal or
 *    sends anything. An assistant that can act on a customer's behalf
 *    while nobody is watching is a different product with a different
 *    risk profile, and the registry is shaped so a write tool would have
 *    to be added deliberately rather than arrive by accident.
 *
 * 2. EVERY TOOL IS SCOPED TO ONE ACCOUNT AND ONE CONTACT. The context
 *    below carries both, and no tool takes an id from the model. The
 *    model cannot ask about a contact it is not talking to, because
 *    there is no argument through which it could name one.
 *
 * 3. NOTHING IS ON BY DEFAULT. `ai_configs.enabled_tools` starts empty
 *    (migration 053). A tool is the assistant reaching into the
 *    account's data, and that is a decision somebody makes, not one they
 *    discover was made for them.
 *
 * Unknown names are dropped on read, so deleting a tool from this file
 * never needs a data migration.
 */

export interface ToolContext {
  db: SupabaseClient;
  accountId: string;
  /** The contact on the other end of this conversation. */
  contactId: string | null;
  conversationId: string | null;
}

export interface AiTool {
  name: string;
  /**
   * What the MODEL reads to decide whether to call it. Written for the
   * model, not for the settings screen — the screen has its own copy in
   * the catalogues, in the operator's language.
   */
  description: string;
  /** JSON Schema for the arguments. Both providers accept this shape. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /** i18n key under `Settings.aiTools`. */
  labelKey: string;
  /**
   * Returns a compact string. NOT JSON with everything in it: the result
   * goes back into the context window on every subsequent turn, and a
   * model reads a sentence more reliably than it reads a serialised row
   * with eleven null fields in it.
   */
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<string>;
}

/** How many chained tool calls one generation may make. */
export const MAX_TOOL_ROUNDS = 3;

const NO_CONTACT = 'Não há um contato associado a esta conversa.';

// ------------------------------------------------------------------
// The tools
// ------------------------------------------------------------------

const contactSummary: AiTool = {
  name: 'get_contact',
  description:
    'Retrieve the CRM record of the customer in this conversation: name, ' +
    'company, city, tags, last purchase date and average ticket. Use it ' +
    'before answering anything that depends on who this customer is or ' +
    'what they have bought before. Takes no arguments.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  labelKey: 'getContact',
  async run(ctx) {
    if (!ctx.contactId) return NO_CONTACT;

    const { data, error } = await ctx.db
      .from('contacts')
      .select(
        'name, company, city, state, email, last_purchase_at, next_purchase_expected_at, average_ticket, notes'
      )
      .eq('id', ctx.contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error || !data) return NO_CONTACT;

    const row = data as Record<string, unknown>;
    // A sentence per known fact, and nothing at all for the unknown
    // ones. "empresa: null" reads to a model as a fact about the
    // company's name.
    const parts: string[] = [];
    const say = (label: string, value: unknown) => {
      if (value === null || value === undefined || value === '') return;
      parts.push(`${label}: ${String(value)}`);
    };
    say('Nome', row.name);
    say('Empresa', row.company);
    say('Cidade', [row.city, row.state].filter(Boolean).join('/'));
    say('E-mail', row.email);
    say('Última compra', row.last_purchase_at);
    say('Próxima compra prevista', row.next_purchase_expected_at);
    say('Ticket médio', row.average_ticket);
    say('Observações', row.notes);

    return parts.length ? parts.join('\n') : NO_CONTACT;
  },
};

const openDeal: AiTool = {
  name: 'get_open_deal',
  description:
    'Retrieve the open sales opportunity for this customer, if there is ' +
    'one: its title, stage, value and expected close date. Use it when ' +
    'the customer refers to a quote, an order in progress or a price ' +
    'already discussed. Takes no arguments.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  labelKey: 'getOpenDeal',
  async run(ctx) {
    if (!ctx.contactId) return NO_CONTACT;

    const { data, error } = await ctx.db
      .from('deals')
      .select('title, value, currency, expected_close_date, stage:pipeline_stages(name)')
      .eq('contact_id', ctx.contactId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error || !data?.length) {
      return 'Não há oportunidade aberta para este cliente.';
    }

    const deal = data[0] as Record<string, unknown>;
    const stage = deal.stage as { name?: string } | { name?: string }[] | null;
    const stageName = Array.isArray(stage) ? stage[0]?.name : stage?.name;

    return [
      `Oportunidade: ${deal.title}`,
      stageName ? `Etapa: ${stageName}` : null,
      `Valor: ${deal.value} ${deal.currency ?? ''}`.trim(),
      deal.expected_close_date
        ? `Previsão de fechamento: ${deal.expected_close_date}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
  },
};

const searchKnowledge: AiTool = {
  name: 'search_knowledge',
  description:
    'Search the company knowledge base for a specific term. The most ' +
    'relevant passages are already in your context; use this only when ' +
    'you need something they do not cover — a different product, a ' +
    'policy, a number you were not given.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to look for, in the customer’s own words.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  labelKey: 'searchKnowledge',
  async run(ctx, args) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return 'Busca vazia.';

    // Lexical only, deliberately. The semantic path needs an embeddings
    // key and an API round trip, and this tool runs INSIDE a generation
    // the customer is waiting on — the good hits are already in the
    // context from `retrieveKnowledge`, and this is the long tail.
    const { data, error } = await ctx.db
      .from('ai_knowledge_chunks')
      .select('content')
      .eq('account_id', ctx.accountId)
      .textSearch('fts', query, { type: 'websearch', config: 'simple' })
      .limit(3);

    if (error || !data?.length) {
      return `Nada encontrado na base sobre "${query}".`;
    }
    return (data as Array<{ content: string }>)
      .map((row, i) => `[${i + 1}] ${row.content}`)
      .join('\n\n');
  },
};

const searchProducts: AiTool = {
  name: 'search_products',
  description:
    'Search the company product catalogue by name, code or size (e.g. ' +
    '"40x60") and return the measurements, thickness, material, price ' +
    'and unit. Use it whenever the customer names a product, gives a ' +
    'measurement, or asks what something costs.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Product name, code or part of one.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  labelKey: 'searchProducts',
  async run(ctx, args) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return 'Busca vazia.';

    // `size_label` is in the OR because "40x60" is how a customer asks
    // for the product — see migration 055. Matching only the name means
    // the one question this tool exists for goes unanswered.
    type Row = Record<string, unknown>;

    const wide = await ctx.db
      .from('products')
      .select(
        'name, sku, unit, price, currency, description, size_label, thickness_micron, material, color'
      )
      .eq('account_id', ctx.accountId)
      .eq('active', true)
      .or(
        `name.ilike.%${query}%,sku.ilike.%${query}%,size_label.ilike.%${query}%`
      )
      .limit(5);

    let data = wide.data as Row[] | null;
    let error = wide.error;

    // Pre-055 there are no measurement columns, and naming one in the
    // `or()` is a 42703 for the whole query. The catalogue still answers
    // — with less in the answer.
    if (error) {
      const narrow = await ctx.db
        .from('products')
        .select('name, sku, unit, price, currency, description')
        .eq('account_id', ctx.accountId)
        .eq('active', true)
        .or(`name.ilike.%${query}%,sku.ilike.%${query}%`)
        .limit(5);
      data = narrow.data as Row[] | null;
      error = narrow.error;
    }

    if (error) {
      // Pre-054 the table does not exist. Saying so to the MODEL rather
      // than throwing keeps the generation alive: it answers without the
      // catalogue instead of the customer getting nothing.
      return 'O catálogo de produtos não está disponível.';
    }
    if (!data?.length) return `Nenhum produto encontrado para "${query}".`;

    return data
      .map((p) =>
        [
          `${p.name}${p.sku ? ` (${p.sku})` : ''}`,
          // The measurement first among the details: it is what the
          // customer named, and a number the model can repeat back
          // exactly beats a paragraph it has to summarise.
          p.size_label ? `medida: ${p.size_label}` : null,
          p.thickness_micron ? `espessura: ${p.thickness_micron} micras` : null,
          p.material ? `material: ${p.material}` : null,
          p.color ? `cor: ${p.color}` : null,
          p.price != null ? `preço: ${p.price} ${p.currency ?? ''}`.trim() : null,
          p.unit ? `unidade: ${p.unit}` : null,
          p.description ? String(p.description).slice(0, 160) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      )
      .join('\n');
  },
};

/** The closed vocabulary, in the order the settings screen lists them. */
export const AI_TOOLS: AiTool[] = [
  contactSummary,
  openDeal,
  searchProducts,
  searchKnowledge,
];

export const AI_TOOL_NAMES = AI_TOOLS.map((t) => t.name);

/**
 * The tools this account turned on, in registry order.
 *
 * Silently drops names the code no longer knows — a stale entry is a
 * tool that used to exist, not an error, and failing a generation over
 * it would be the wrong trade at the worst moment.
 */
export function resolveTools(enabled: string[] | null | undefined): AiTool[] {
  if (!enabled?.length) return [];
  const wanted = new Set(enabled);
  return AI_TOOLS.filter((tool) => wanted.has(tool.name));
}

/**
 * Run one tool call by name.
 *
 * NEVER THROWS. A tool that fails hands the model a sentence saying so,
 * and the model writes an answer without it — which is the behaviour the
 * customer waiting on the other end wants. Throwing here would abort a
 * generation over an optional lookup.
 */
export async function runTool(
  tools: AiTool[],
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `Ferramenta desconhecida: ${name}`;
  try {
    const result = await tool.run(ctx, args ?? {});
    // A tool that returns a novel is a tool that evicts the conversation
    // from the context window.
    return result.slice(0, 2000);
  } catch (err) {
    console.error(`[ai tools] ${name} failed:`, err);
    return `A consulta "${name}" falhou.`;
  }
}
