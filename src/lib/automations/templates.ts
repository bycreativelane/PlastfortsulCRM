import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
  /**
   * Name of the message this step sends, under
   * `Automations.templates.<slug>.copy` in the catalogue. Present on
   * every step that puts words in front of a customer — see
   * `localizeTemplate` for why the words are not in this file.
   */
  copyKey?: string
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  /**
   * True when the trigger's keywords are user-facing content rather than
   * configuration — a Brazilian customer types "orçamento", not "quote".
   * The list lives in the catalogue as one comma-separated string.
   */
  localizedKeywords?: boolean
  steps: TemplateStepSeed[]
}

/**
 * The four starting points offered on the automations page.
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
 */
export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
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
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}

/**
 * A translator scoped to `Automations.templates`, which is what both
 * `useTranslations('Automations.templates')` (client) and
 * `getTranslations('Automations.templates')` (server) hand back. Typed
 * loosely on purpose — next-intl's own type is generic over the
 * catalogue and would drag that generic through every caller for no
 * benefit here.
 */
export type TemplateTranslator = (key: string) => string

export interface LocalizedTemplate {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
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
  t: TemplateTranslator,
): LocalizedTemplate {
  const trigger_config = def.localizedKeywords
    ? {
        ...def.trigger_config,
        keywords: t(`${def.slug}.keywords`)
          .split(',')
          .map((word) => word.trim())
          .filter(Boolean),
      }
    : def.trigger_config

  return {
    slug: def.slug,
    name: t(`${def.slug}.name`),
    description: t(`${def.slug}.description`),
    trigger_type: def.trigger_type,
    trigger_config,
    steps: def.steps.map((seed) =>
      seed.copyKey
        ? {
            ...seed,
            step_config: {
              ...seed.step_config,
              text: t(`${def.slug}.copy.${seed.copyKey}`),
            } as AutomationStepConfig,
          }
        : seed,
    ),
  }
}
