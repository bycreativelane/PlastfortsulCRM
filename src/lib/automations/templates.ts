import type {
  AutomationReentryPolicy,
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types';

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  // The official sales flow (docs/spec-automacoes-fluxo.md, Parte E).
  | 'funnel_quote_sent'
  | 'funnel_open_24h'
  | 'funnel_followup'
  | 'funnel_customer_replied'
  | 'funnel_fridge_30d'
  | 'funnel_in_progress'
  | 'funnel_served'
  | 'funnel_after_sale'
  | 'funnel_future_purchase'
  | 'funnel_birthday';

/**
 * Account resources a template names rather than ids: a stage, a tag, a
 * quick reply. Resolved per account at install time by
 * `resolveTemplateReferences` — the ids differ on every installation and
 * the names are what the official flow is written in.
 */
export interface TemplateRefs {
  /** One stage, by name — for move_deal_stage and the stage trigger. */
  stage?: string;
  /** Several stages, by name — for deal_in_stage. */
  stages?: string[];
  tag?: string;
  /** A quick reply, by SHORTCUT (without the slash). */
  quick_reply?: string;
}

export interface TemplateStepSeed {
  step_type: AutomationStepType;
  step_config: AutomationStepConfig;
  branch?: 'yes' | 'no' | null;
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null;
  /**
   * Name of the message this step sends, under
   * `Automations.templates.<slug>.copy` in the catalogue. Present on
   * every step that puts words in front of a customer — see
   * `localizeTemplate` for why the words are not in this file.
   */
  copyKey?: string;
  /** Names to resolve into `step_config` ids on install. */
  refs?: TemplateRefs;
}

/** The automation-level rules a template asks for (migration 065). */
export interface TemplateRules {
  /** The funnel, by name. Also where its stage names are looked up. */
  pipeline?: string;
  cancel_on_reply?: boolean;
  /** Stage names. */
  cancel_when_stage_in?: string[];
  reentry_policy?: AutomationReentryPolicy;
  reentry_days?: number;
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug;
  /** Which gallery it sits in. */
  group: 'general' | 'funnel';
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  /** Names to resolve into `trigger_config` ids on install. */
  triggerRefs?: TemplateRefs;
  /**
   * True when the trigger's keywords are user-facing content rather than
   * configuration — a Brazilian customer types "orçamento", not "quote".
   * The list lives in the catalogue as one comma-separated string.
   */
  localizedKeywords?: boolean;
  steps: TemplateStepSeed[];
  rules?: TemplateRules;
}

/** The stage names of the official flow, as the resolver looks them up. */
export const FUNNEL = {
  pipeline: 'Vendas',
  newLead: 'Novo Lead',
  open: 'Em Aberto',
  followUp: 'Follow-up',
  negotiating: 'Em Negociação',
  call: 'Ligação',
  inProgress: 'Em Andamento',
  served: 'Atendido',
  afterSale: 'Pós-venda',
  futurePurchase: 'Compra Futura',
  fridge30: 'Geladeira 30D',
  fridge60: 'Geladeira 60D',
  lost: 'Venda Perdida',
} as const;

/** §22 of the official flow: entering any of these ends a follow-up. */
const FOLLOWUP_CANCEL_STAGES = [
  FUNNEL.negotiating,
  FUNNEL.inProgress,
  FUNNEL.served,
  FUNNEL.lost,
  FUNNEL.futurePurchase,
];

const PT_BR = 'pt_BR';

/**
 * The starting points offered on the automations page.
 *
 * SHAPE ONLY. Not one word of this file reaches a screen: the names,
 * the descriptions and every message the templates send live in
 * `messages/<locale>.json` under `Automations.templates`, and
 * `localizeTemplate` puts the two together.
 *
 * They used to be English string literals right here, which is how an
 * app configured for pt-BR — sidebar, buttons, empty states, all of it
 * translated — still offered "Out of Office / Auto-reply during
 * off-hours" on its own automations page, and then seeded the new
 * automation with an English message for the customer to receive. The
 * structure (which trigger, which steps, which branch) is code and
 * belongs in code; the words are content and belong with the content.
 *
 * The `funnel_*` templates are the ten automations of the official sales
 * flow (docs/spec-automacoes-fluxo.md, Parte E). They name stages, tags
 * and quick replies rather than carrying ids, and every Meta template
 * they send is one of `src/lib/whatsapp/plastfortsul-templates.ts`.
 */
export const AUTOMATION_TEMPLATES: Record<
  TemplateSlug,
  AutomationTemplateDefinition
> = {
  welcome_message: {
    slug: 'welcome_message',
    group: 'general',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: { text: '' },
        copyKey: 'greeting',
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    group: 'general',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: { text: '' },
        parent_index: 0,
        branch: 'yes',
        copyKey: 'offHours',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    group: 'general',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: [],
      match_type: 'contains',
    },
    localizedKeywords: true,
    steps: [
      {
        step_type: 'send_message',
        step_config: { text: '' },
        copyKey: 'qualify',
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    group: 'general',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: { text: '' },
        copyKey: 'nudge',
      },
    ],
  },

  // ── The official sales flow ───────────────────────────────────────────

  /** §1 — `/aberto` sent by the team → Em Aberto. */
  funnel_quote_sent: {
    slug: 'funnel_quote_sent',
    group: 'funnel',
    trigger_type: 'team_message_sent',
    trigger_config: { quick_reply_id: '' },
    triggerRefs: { quick_reply: 'aberto' },
    steps: [
      {
        step_type: 'move_deal_stage',
        step_config: { stage_id: '' },
        refs: { stage: FUNNEL.open },
      },
    ],
    rules: { pipeline: FUNNEL.pipeline },
  },

  /** §2 — 24 h in Em Aberto without a reply → Follow-up. */
  funnel_open_24h: {
    slug: 'funnel_open_24h',
    group: 'funnel',
    trigger_type: 'deal_stage_entered',
    trigger_config: { stage_id: '' },
    triggerRefs: { stage: FUNNEL.open },
    steps: [
      { step_type: 'wait', step_config: { amount: 24, unit: 'hours' } },
      {
        step_type: 'condition',
        step_config: {
          subject: 'customer_replied_since',
          operand: 'stage_entry',
        },
      },
      {
        step_type: 'end',
        step_config: { reason: 'customer_replied' },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'move_deal_stage',
        step_config: { stage_id: '' },
        refs: { stage: FUNNEL.followUp },
        parent_index: 1,
        branch: 'no',
      },
    ],
    rules: {
      pipeline: FUNNEL.pipeline,
      cancel_on_reply: true,
      cancel_when_stage_in: FOLLOWUP_CANCEL_STAGES,
      reentry_policy: 'after_complete',
    },
  },

  /** §3–§4 — D1, D3, D10, then D30, then 24 h → Geladeira 30D. */
  funnel_followup: {
    slug: 'funnel_followup',
    group: 'funnel',
    trigger_type: 'deal_stage_entered',
    trigger_config: { stage_id: '' },
    triggerRefs: { stage: FUNNEL.followUp },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'followup_d1',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}', '2': '{{deal.title}}' },
        },
      },
      { step_type: 'wait', step_config: { amount: 2, unit: 'days' } },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'followup_d3',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}', '2': '{{deal.title}}' },
        },
      },
      { step_type: 'wait', step_config: { amount: 7, unit: 'days' } },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'followup_d10',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}' },
        },
      },
      { step_type: 'wait', step_config: { amount: 20, unit: 'days' } },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'followup_d30',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}' },
        },
      },
      { step_type: 'wait', step_config: { amount: 24, unit: 'hours' } },
      {
        step_type: 'move_deal_stage',
        step_config: { stage_id: '' },
        refs: { stage: FUNNEL.fridge30 },
      },
    ],
    rules: {
      pipeline: FUNNEL.pipeline,
      cancel_on_reply: true,
      cancel_when_stage_in: FOLLOWUP_CANCEL_STAGES,
      reentry_policy: 'after_complete',
    },
  },

  /** §7, §13 — the customer wrote while parked → Em Negociação. */
  funnel_customer_replied: {
    slug: 'funnel_customer_replied',
    group: 'funnel',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: { subject: 'deal_in_stage', stage_ids: [] },
        refs: {
          stages: [
            FUNNEL.followUp,
            FUNNEL.fridge30,
            FUNNEL.fridge60,
            FUNNEL.futurePurchase,
          ],
        },
      },
      {
        step_type: 'move_deal_stage',
        step_config: { stage_id: '' },
        refs: { stage: FUNNEL.negotiating },
        parent_index: 0,
        branch: 'yes',
      },
      {
        step_type: 'end',
        step_config: { reason: 'not_parked' },
        parent_index: 0,
        branch: 'no',
      },
    ],
    rules: { pipeline: FUNNEL.pipeline },
  },

  /** §5 — 30 days in Geladeira 30D → Geladeira 60D. */
  funnel_fridge_30d: {
    slug: 'funnel_fridge_30d',
    group: 'funnel',
    trigger_type: 'deal_stage_entered',
    trigger_config: { stage_id: '' },
    triggerRefs: { stage: FUNNEL.fridge30 },
    steps: [
      { step_type: 'wait', step_config: { amount: 30, unit: 'days' } },
      {
        step_type: 'move_deal_stage',
        step_config: { stage_id: '' },
        refs: { stage: FUNNEL.fridge60 },
      },
    ],
    rules: {
      pipeline: FUNNEL.pipeline,
      cancel_on_reply: true,
      cancel_when_stage_in: FOLLOWUP_CANCEL_STAGES,
      reentry_policy: 'after_complete',
    },
  },

  /** §8 — `/andamento` → Em Andamento, Lead off, Cliente on. */
  funnel_in_progress: {
    slug: 'funnel_in_progress',
    group: 'funnel',
    trigger_type: 'team_message_sent',
    trigger_config: { quick_reply_id: '' },
    triggerRefs: { quick_reply: 'andamento' },
    steps: [
      {
        step_type: 'move_deal_stage',
        step_config: { stage_id: '' },
        refs: { stage: FUNNEL.inProgress },
      },
      {
        step_type: 'remove_tag',
        step_config: { tag_id: '' },
        refs: { tag: 'Lead' },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        refs: { tag: 'Cliente' },
      },
      // A new purchase ends whatever was still parked for this customer —
      // the recompra of the previous order, most of all.
      {
        step_type: 'cancel_automations',
        step_config: { scope: 'contact', automation_ids: [] },
      },
    ],
    rules: { pipeline: FUNNEL.pipeline },
  },

  /** §9 — `/atendido` → Atendido. */
  funnel_served: {
    slug: 'funnel_served',
    group: 'funnel',
    trigger_type: 'team_message_sent',
    trigger_config: { quick_reply_id: '' },
    triggerRefs: { quick_reply: 'atendido' },
    steps: [
      {
        step_type: 'move_deal_stage',
        step_config: { stage_id: '' },
        refs: { stage: FUNNEL.served },
      },
    ],
    rules: { pipeline: FUNNEL.pipeline },
  },

  /** §10–§12 — D20 pós-venda, D60 and D120 recompra, from Atendido. */
  funnel_after_sale: {
    slug: 'funnel_after_sale',
    group: 'funnel',
    trigger_type: 'deal_stage_entered',
    trigger_config: { stage_id: '' },
    triggerRefs: { stage: FUNNEL.served },
    steps: [
      { step_type: 'wait', step_config: { amount: 20, unit: 'days' } },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'posvenda_d20',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}' },
        },
      },
      {
        step_type: 'move_deal_stage',
        step_config: { stage_id: '' },
        refs: { stage: FUNNEL.afterSale },
      },
      { step_type: 'wait', step_config: { amount: 40, unit: 'days' } },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'recompra_60d',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}', '2': '60' },
        },
      },
      { step_type: 'wait', step_config: { amount: 60, unit: 'days' } },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'recompra_60d',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}', '2': '120' },
        },
      },
      { step_type: 'end', step_config: { reason: 'after_sale_complete' } },
    ],
    rules: {
      pipeline: FUNNEL.pipeline,
      cancel_when_stage_in: [FUNNEL.lost],
      reentry_policy: 'after_complete',
    },
  },

  /** §13 — Compra Futura: wait until the date, send, and let §7 move it. */
  funnel_future_purchase: {
    slug: 'funnel_future_purchase',
    group: 'funnel',
    trigger_type: 'deal_stage_entered',
    trigger_config: { stage_id: '' },
    triggerRefs: { stage: FUNNEL.futurePurchase },
    steps: [
      {
        step_type: 'wait',
        step_config: {
          amount: 1,
          unit: 'days',
          mode: 'until_contact_date',
          field: 'next_purchase_expected_at',
          at: '09:00',
        },
      },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'compra_futura',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}' },
        },
      },
      { step_type: 'end', step_config: { reason: 'future_purchase_sent' } },
    ],
    rules: {
      pipeline: FUNNEL.pipeline,
      cancel_on_reply: true,
      cancel_when_stage_in: [
        FUNNEL.negotiating,
        FUNNEL.inProgress,
        FUNNEL.lost,
      ],
      reentry_policy: 'after_complete',
    },
  },

  /** §16 — the birthday. */
  funnel_birthday: {
    slug: 'funnel_birthday',
    group: 'funnel',
    trigger_type: 'date_field_reached',
    trigger_config: { field: 'birthday', at: '09:00' },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'aniversario_cliente',
          language: PT_BR,
          variables: { '1': '{{contact.first_name}}' },
        },
      },
    ],
  },
};

export const TEMPLATE_SLUGS = Object.keys(
  AUTOMATION_TEMPLATES
) as TemplateSlug[];

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null;
}

/**
 * A translator scoped to `Automations.templates`, which is what both
 * `useTranslations('Automations.templates')` (client) and
 * `getTranslations('Automations.templates')` (server) hand back. Typed
 * loosely on purpose — next-intl's own type is generic over the
 * catalogue and would drag that generic through every caller for no
 * benefit here.
 */
export type TemplateTranslator = (key: string) => string;

export interface LocalizedTemplate {
  slug: TemplateSlug;
  group: 'general' | 'funnel';
  name: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  triggerRefs?: TemplateRefs;
  steps: TemplateStepSeed[];
  rules?: TemplateRules;
}

/**
 * Fills a template's shape with the words for the current locale.
 *
 * Everything a user reads or receives comes from here: the card title
 * and blurb on the automations page, the message each `send_message`
 * step is seeded with, and — for the lead qualifier — the keywords that
 * fire it, which are words a customer types and so are as much content
 * as the reply itself.
 */
export function localizeTemplate(
  def: AutomationTemplateDefinition,
  t: TemplateTranslator
): LocalizedTemplate {
  const trigger_config = def.localizedKeywords
    ? {
        ...def.trigger_config,
        keywords: t(`${def.slug}.keywords`)
          .split(',')
          .map((word) => word.trim())
          .filter(Boolean),
      }
    : def.trigger_config;

  return {
    slug: def.slug,
    group: def.group,
    name: t(`${def.slug}.name`),
    description: t(`${def.slug}.description`),
    trigger_type: def.trigger_type,
    trigger_config,
    triggerRefs: def.triggerRefs,
    steps: def.steps.map((seed) =>
      seed.copyKey
        ? {
            ...seed,
            step_config: {
              ...seed.step_config,
              text: t(`${def.slug}.copy.${seed.copyKey}`),
            } as AutomationStepConfig,
          }
        : seed
    ),
    rules: def.rules,
  };
}

// ------------------------------------------------------------
// Name → id resolution, per account
// ------------------------------------------------------------

export interface TemplateLookup {
  pipelines: { id: string; name: string }[];
  stages: { id: string; name: string; pipeline_id: string }[];
  tags: { id: string; name: string }[];
  quickReplies: {
    id: string;
    shortcut?: string | null;
    title?: string | null;
  }[];
}

export interface ResolvedRules {
  pipeline_id: string | null;
  cancel_on_reply: boolean;
  cancel_when_stage_in: string[];
  reentry_policy: AutomationReentryPolicy;
  reentry_days: number | null;
}

export interface ResolvedTemplate {
  trigger_config: Record<string, unknown>;
  steps: TemplateStepSeed[];
  rules: ResolvedRules;
  /** The names nothing in the account answered to — for the author to pick by hand. */
  unresolved: string[];
}

/**
 * Names that mean the same stage. The seed that predates the official flow
 * called two of them differently, and a board somebody typed by hand will
 * too. The resolver tries the name, then each alias.
 */
const STAGE_ALIASES: Record<string, string[]> = {
  [FUNNEL.fridge30]: ['Geladeira 30 dias', 'Geladeira 30'],
  [FUNNEL.fridge60]: ['Geladeira 60 dias', 'Geladeira 60'],
  [FUNNEL.lost]: ['Perdido', 'Perdida', 'Lost'],
  [FUNNEL.followUp]: ['Follow up', 'Followup'],
  [FUNNEL.negotiating]: ['Em negociacao', 'Negociação'],
  [FUNNEL.afterSale]: ['Pos-venda', 'Pós venda', 'Pos venda'],
};

/** Case, accents and surrounding space do not make two names different. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findStage(
  name: string,
  lookup: TemplateLookup,
  pipelineId: string | null
): string | null {
  const candidates = [name, ...(STAGE_ALIASES[name] ?? [])].map(normalizeName);
  const inPipeline = pipelineId
    ? lookup.stages.filter((s) => s.pipeline_id === pipelineId)
    : [];
  for (const list of [inPipeline, lookup.stages]) {
    for (const wanted of candidates) {
      const hit = list.find((s) => normalizeName(s.name) === wanted);
      if (hit) return hit.id;
    }
  }
  return null;
}

function findTag(name: string, lookup: TemplateLookup): string | null {
  const wanted = normalizeName(name);
  return lookup.tags.find((t) => normalizeName(t.name) === wanted)?.id ?? null;
}

function findQuickReply(
  shortcut: string,
  lookup: TemplateLookup
): string | null {
  const wanted = normalizeName(shortcut.replace(/^\//, ''));
  return (
    lookup.quickReplies.find(
      (q) => q.shortcut && normalizeName(q.shortcut) === wanted
    )?.id ??
    lookup.quickReplies.find(
      (q) => q.title && normalizeName(q.title) === wanted
    )?.id ??
    null
  );
}

/**
 * Turn the names a template speaks in into this account's ids.
 *
 * Anything not found is left EMPTY, listed in `unresolved`, and caught by
 * activation validation — the author picks it by hand in the builder. An
 * automation installed with a guessed id would be worse than one that
 * asks: it would move deals into a stage nobody chose.
 */
export function resolveTemplateReferences(
  template: LocalizedTemplate,
  lookup: TemplateLookup
): ResolvedTemplate {
  const unresolved: string[] = [];
  const miss = (label: string) => {
    if (!unresolved.includes(label)) unresolved.push(label);
  };

  const rules = template.rules ?? {};
  let pipelineId: string | null = null;
  if (rules.pipeline) {
    const wanted = normalizeName(rules.pipeline);
    pipelineId =
      lookup.pipelines.find((p) => normalizeName(p.name) === wanted)?.id ??
      null;
    if (!pipelineId) miss(rules.pipeline);
  }

  const stageId = (name: string): string => {
    const id = findStage(name, lookup, pipelineId);
    if (!id) miss(name);
    return id ?? '';
  };

  const trigger_config: Record<string, unknown> = {
    ...(template.trigger_config as Record<string, unknown>),
  };
  if (template.triggerRefs?.stage) {
    trigger_config.stage_id = stageId(template.triggerRefs.stage);
    if (pipelineId) trigger_config.pipeline_id = pipelineId;
  }
  if (template.triggerRefs?.quick_reply) {
    const id = findQuickReply(template.triggerRefs.quick_reply, lookup);
    if (!id) miss(`/${template.triggerRefs.quick_reply}`);
    trigger_config.quick_reply_id = id ?? '';
  }

  const steps = template.steps.map((seed) => {
    if (!seed.refs) return seed;
    const config: Record<string, unknown> = {
      ...(seed.step_config as Record<string, unknown>),
    };
    if (seed.refs.stage) config.stage_id = stageId(seed.refs.stage);
    if (seed.refs.stages) {
      config.stage_ids = seed.refs.stages
        .map((name) => stageId(name))
        .filter(Boolean);
    }
    if (seed.refs.tag) {
      const id = findTag(seed.refs.tag, lookup);
      if (!id) miss(seed.refs.tag);
      config.tag_id = id ?? '';
    }
    return { ...seed, step_config: config as AutomationStepConfig };
  });

  const cancelStages = (rules.cancel_when_stage_in ?? [])
    .map((name) => stageId(name))
    .filter(Boolean);

  return {
    trigger_config,
    steps,
    rules: {
      pipeline_id: pipelineId,
      cancel_on_reply: rules.cancel_on_reply ?? false,
      cancel_when_stage_in: cancelStages,
      reentry_policy: rules.reentry_policy ?? 'always',
      reentry_days: rules.reentry_days ?? null,
    },
    unresolved,
  };
}

/** Whether a template names anything that needs the account to resolve. */
export function templateNeedsLookup(
  def: AutomationTemplateDefinition
): boolean {
  return (
    !!def.triggerRefs ||
    !!def.rules?.pipeline ||
    (def.rules?.cancel_when_stage_in?.length ?? 0) > 0 ||
    def.steps.some((s) => !!s.refs)
  );
}
