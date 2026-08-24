/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 *
 * SHAPE ONLY, though. The English below is a fallback, not what ships:
 * every word a customer would read — node text, button and list-row
 * titles, prompts, handoff notes, the keywords that fire the trigger —
 * is overlaid from `Flows.templates` in the message catalogue by
 * `localizeFlowTemplate`. A pt-BR instance cloning "FAQ bot" got a bot
 * that answered in English, inside an app that was otherwise entirely
 * in Portuguese.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: "Welcome menu",
  description:
    "Greet customers who type a keyword and route them to the right agent based on whether they're new or existing.",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: ["support", "help", "hi"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: "Hi! 👋 Welcome to support. Are you an existing customer or new here?",
        footer_text: "Tap a button below to continue.",
        buttons: [
          {
            reply_id: "existing",
            title: "Existing customer",
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: "New customer",
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: "Existing customer needs assistance — please check account history before replying.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: "New customer — share pricing + onboarding link.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: "FAQ bot",
  description:
    "Answer common questions automatically. Customer picks a topic from a list; the bot replies with the answer and ends.",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["faq", "question", "info"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: "What can I help you with?",
        button_label: "View topics",
        sections: [
          {
            title: "Common questions",
            rows: [
              {
                reply_id: "hours",
                title: "Opening hours",
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: "Pricing",
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: "Refund policy",
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: "Other",
            rows: [
              {
                reply_id: "human",
                title: "Talk to a human",
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: "We're open Mon–Fri, 9am–6pm local time. Weekend support is limited to urgent issues.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: "Our pricing starts at $9/mo. Visit https://example.com/pricing for the full breakdown.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: "Refunds are honored within 30 days of purchase. Reply with your order number and we'll process it.",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: "Customer asked to talk to a human from the FAQ bot.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: "Lead capture",
  description:
    "Greet first-time inbounds, capture name + email + company, then hand off to sales with the answers in the note.",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: "Welcome! 👋 I'll ask a few quick questions so we can get you to the right person.",
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: "What's your name?",
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: "Thanks {{vars.name}}! What's your work email?",
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: "Almost done — what's your company name?",
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: "New lead — name={{vars.name}}, email={{vars.email}}, company={{vars.company}}.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}

// ============================================================
// Localisation overlay
// ============================================================

/**
 * The words for one template, as they sit in the catalogue under
 * `Flows.templates.<slug>`.
 *
 * Read as a raw object rather than through `t()` on purpose. Two of
 * these strings carry `{{vars.name}}` — WhatsApp's own placeholder
 * syntax, which the flow engine substitutes at send time — and ICU
 * reads `{` as the start of an argument and rejects the message
 * outright, silently, rendering the key path to the customer instead.
 * `messages.test.ts` exists because twelve strings already shipped that
 * way. Raw access never touches the ICU parser, and these are static
 * strings with nothing to interpolate anyway.
 */
export interface FlowTemplateCopy {
  name?: string;
  description?: string;
  /** Comma-separated; the trigger's keywords are words a customer types. */
  keywords?: string;
  /** Keyed by `node_key`, then by the config field being replaced. */
  nodes?: Record<
    string,
    {
      text?: string;
      header_text?: string;
      footer_text?: string;
      button_label?: string;
      prompt_text?: string;
      note?: string;
      /** Button / list-row titles, keyed by their stable `reply_id`. */
      options?: Record<string, string>;
      /** List section headings, in order — sections have no id. */
      sections?: string[];
    }
  >;
}

export type FlowTemplateCatalogue = Record<string, FlowTemplateCopy>;

/** Config fields that are prose and get replaced one-for-one. */
const TEXT_FIELDS = [
  "text",
  "header_text",
  "footer_text",
  "button_label",
  "prompt_text",
  "note",
] as const;

/**
 * Returns the template with every user-visible string swapped for the
 * current locale's, leaving `node_key`s, `reply_id`s and every
 * `next_node_key` untouched — those are wiring, and translating them
 * would break the flow rather than the copy.
 *
 * Missing catalogue entries fall through to what the definition says,
 * so a half-translated locale degrades to English one string at a time
 * instead of rendering a key path.
 */
export function localizeFlowTemplate(
  template: FlowTemplate,
  catalogue?: FlowTemplateCatalogue,
): FlowTemplate {
  const copy = catalogue?.[template.slug];
  if (!copy) return template;

  const keywords = copy.keywords
    ?.split(",")
    .map((word) => word.trim())
    .filter(Boolean);

  return {
    ...template,
    name: copy.name ?? template.name,
    description: copy.description ?? template.description,
    trigger_config:
      keywords && keywords.length > 0
        ? { ...template.trigger_config, keywords }
        : template.trigger_config,
    nodes: template.nodes.map((node) => {
      const nodeCopy = copy.nodes?.[node.node_key];
      if (!nodeCopy) return node;

      const config: Record<string, unknown> = { ...node.config };

      for (const field of TEXT_FIELDS) {
        const replacement = nodeCopy[field];
        if (typeof replacement === "string" && field in config) {
          config[field] = replacement;
        }
      }

      if (Array.isArray(config.buttons)) {
        config.buttons = (config.buttons as { reply_id: string }[]).map(
          (button) => ({
            ...button,
            title: nodeCopy.options?.[button.reply_id] ??
              (button as { title?: string }).title,
          }),
        );
      }

      if (Array.isArray(config.sections)) {
        config.sections = (
          config.sections as {
            title?: string;
            rows?: { reply_id: string; title?: string }[];
          }[]
        ).map((section, index) => ({
          ...section,
          title: nodeCopy.sections?.[index] ?? section.title,
          rows: section.rows?.map((row) => ({
            ...row,
            title: nodeCopy.options?.[row.reply_id] ?? row.title,
          })),
        }));
      }

      return { ...node, config };
    }),
  };
}
