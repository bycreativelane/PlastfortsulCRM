'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
  MessageSquare,
  FileText,
  Tag,
  TagIcon,
  UserCheck,
  PencilLine,
  Briefcase,
  Hourglass,
  GitBranch,
  Webhook,
  CircleSlash,
  Zap,
  Loader2,
  ArrowDown,
  ArrowUp,
  MousePointerClick,
  List,
  ArrowRightToLine,
  FilePenLine,
  OctagonX,
  CircleStop,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  AccountMember,
  AutomationReentryPolicy,
  AutomationStepType,
  AutomationTriggerType,
  CustomField,
  InteractiveMessagePayload,
  KeywordMatchTriggerConfig,
  MessageTemplate,
  QuickReply,
  Tag as TagRecord,
} from '@/types';
import { LOSS_REASONS, isLostStage } from '@/lib/deals/outcome';
import {
  InteractiveBuilder,
  blankButtonsPayload,
  blankListPayload,
} from '@/components/interactive/interactive-builder';
import { interactivePayloadPreviewText } from '@/lib/whatsapp/interactive';
import { createClient } from '@/lib/supabase/client';
import {
  childPath,
  insertAt,
  mapAtPath,
  moveAt,
  removeAt,
  type ParentScope,
  type StepPath,
} from '@/lib/automations/builder-tree';
import { cn } from '@/lib/utils';
import { OptionSelect } from '@/components/ui/option-select';

// ------------------------------------------------------------
// Types (builder-local — mirror the flattened rows we POST)
// ------------------------------------------------------------

export interface BuilderStep {
  /** Client id; the API assigns real UUIDs server-side. */
  cid: string;
  step_type: AutomationStepType;
  step_config: Record<string, unknown>;
  branches?: { yes: BuilderStep[]; no: BuilderStep[] };
}

export interface BuilderInitial {
  id?: string;
  name: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  is_active: boolean;
  steps: BuilderStep[];
  /* ---- Rules (migration 065). Defaults keep pre-065 behaviour. ---- */
  /** The funnel whose deals this automation works; null = any. */
  pipeline_id: string | null;
  cancel_on_reply: boolean;
  cancel_when_stage_in: string[];
  reentry_policy: AutomationReentryPolicy;
  reentry_days: number | null;
}

/** The rule defaults — what a fresh automation, or a pre-065 row, has. */
export const DEFAULT_RULES: Pick<
  BuilderInitial,
  | 'pipeline_id'
  | 'cancel_on_reply'
  | 'cancel_when_stage_in'
  | 'reentry_policy'
  | 'reentry_days'
> = {
  pipeline_id: null,
  cancel_on_reply: false,
  cancel_when_stage_in: [],
  reentry_policy: 'always',
  reentry_days: null,
};

// ------------------------------------------------------------
// Step metadata — one source of truth for icon + label + border color
// ------------------------------------------------------------

interface StepMeta {
  label: string;
  icon: typeof Zap;
  /** Left-border accent color per spec. */
  kind: StepKind;
}

/**
 * What kind of thing a step is, which is what the card's colour says.
 *
 * Five kinds, and only two of them carry colour:
 *
 *   action / wait / branch — grey. The machine doing its job is information,
 *                            not a request; the icon says which action, the
 *                            colour says nothing because there is nothing to
 *                            say.
 *   human                  — amber. `assign_conversation` is the one step
 *                            whose whole purpose is to put a conversation in
 *                            front of a person.
 *   stop                   — red. Closing the conversation ends the run; it
 *                            is the only step you cannot walk back from
 *                            inside the flow.
 *
 * This replaces a `border-l-4` accent that was `border-l-primary` on eleven
 * of the thirteen step types — a coloured bar that, being on almost every
 * card, distinguished nothing while spending the accent colour on all of it.
 */
type StepKind = 'action' | 'wait' | 'branch' | 'human' | 'stop';

const KIND_STYLE: Record<
  StepKind,
  { head: string; icon: string; label: string }
> = {
  action: {
    head: 'bg-card-2',
    icon: 'bg-auto text-card',
    label: 'text-auto-ink',
  },
  wait: {
    head: 'bg-card-2',
    icon: 'bg-muted text-secondary-foreground',
    label: 'text-secondary-foreground',
  },
  branch: {
    head: 'bg-card-2',
    icon: 'bg-secondary-foreground text-card',
    label: 'text-secondary-foreground',
  },
  // The two solid fills use the -strong / -solid tokens, not the plain
  // 500s. globals.css says it outright next to --human-strong: amber at
  // 500 carries white text at 2.9:1, which is below AA and worse still in
  // dark mode (2.05:1). --human-strong and --danger-solid are the two
  // values that were audited to hold white, and theme-contrast.test.ts
  // already guards the second one.
  human: {
    head: 'bg-human-soft',
    icon: 'bg-human-strong text-white',
    label: 'text-human-ink',
  },
  stop: {
    head: 'bg-danger-soft',
    icon: 'bg-danger-solid text-white',
    label: 'text-danger-ink',
  },
};

const STEP_META: Record<AutomationStepType, StepMeta> = {
  send_message: { label: 'send_message', icon: MessageSquare, kind: 'action' },
  send_buttons: {
    label: 'send_buttons',
    icon: MousePointerClick,
    kind: 'action',
  },
  send_list: { label: 'send_list', icon: List, kind: 'action' },
  send_template: { label: 'send_template', icon: FileText, kind: 'action' },
  add_tag: { label: 'add_tag', icon: Tag, kind: 'action' },
  remove_tag: { label: 'remove_tag', icon: TagIcon, kind: 'action' },
  assign_conversation: {
    label: 'assign_conversation',
    icon: UserCheck,
    kind: 'human',
  },
  update_contact_field: {
    label: 'update_contact_field',
    icon: PencilLine,
    kind: 'action',
  },
  create_deal: { label: 'create_deal', icon: Briefcase, kind: 'action' },
  wait: { label: 'wait', icon: Hourglass, kind: 'wait' },
  condition: { label: 'condition', icon: GitBranch, kind: 'branch' },
  send_webhook: { label: 'send_webhook', icon: Webhook, kind: 'action' },
  close_conversation: {
    label: 'close_conversation',
    icon: CircleSlash,
    kind: 'stop',
  },
  move_deal_stage: {
    label: 'move_deal_stage',
    icon: ArrowRightToLine,
    kind: 'action',
  },
  update_deal: { label: 'update_deal', icon: FilePenLine, kind: 'action' },
  cancel_automations: {
    label: 'cancel_automations',
    icon: OctagonX,
    kind: 'action',
  },
  end: { label: 'end', icon: CircleStop, kind: 'stop' },
};

const ADDABLE_STEPS: AutomationStepType[] = [
  'send_message',
  'send_buttons',
  'send_list',
  'send_template',
  'add_tag',
  'remove_tag',
  'assign_conversation',
  'update_contact_field',
  'create_deal',
  'move_deal_stage',
  'update_deal',
  'wait',
  'condition',
  'cancel_automations',
  'send_webhook',
  'close_conversation',
  'end',
];

/**
 * What the picker offers. `time_based` and `conversation_assigned` are
 * NOT here: nothing in the product dispatches either, and offering a
 * trigger that never fires is worse than not offering it. An automation
 * saved with one of them still opens — `TriggerCard` adds the current
 * type to the list so editing does not silently rewrite the trigger.
 */
const TRIGGER_OPTIONS: { value: AutomationTriggerType }[] = [
  { value: 'new_message_received' },
  { value: 'first_inbound_message' },
  { value: 'keyword_match' },
  { value: 'interactive_reply' },
  { value: 'new_contact_created' },
  { value: 'tag_added' },
  { value: 'deal_stage_entered' },
  { value: 'team_message_sent' },
  { value: 'date_field_reached' },
];

function cid(): string {
  return (
    'c_' +
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  );
}

// The send_buttons / send_list step_config IS an InteractiveMessagePayload,
// but step_config is typed generically as Record<string, unknown>. These two
// helpers hold the single unavoidable structural cast in one place so a
// payload-shape change has one seam to update instead of four scattered
// `as unknown as` sites.
function toStepConfig(p: InteractiveMessagePayload): Record<string, unknown> {
  return p as unknown as Record<string, unknown>;
}
function asInteractive(
  cfg: Record<string, unknown>
): InteractiveMessagePayload {
  return cfg as unknown as InteractiveMessagePayload;
}

function blankConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case 'send_message':
      return { text: '' };
    case 'send_buttons':
      return toStepConfig(blankButtonsPayload());
    case 'send_list':
      return toStepConfig(blankListPayload());
    case 'send_template':
      return { template_name: '', language: 'en_US' };
    case 'add_tag':
    case 'remove_tag':
      return { tag_id: '' };
    case 'assign_conversation':
      return { mode: 'round_robin' };
    case 'update_contact_field':
      return { field: 'name', value: '' };
    case 'create_deal':
      return { pipeline_id: '', stage_id: '', title: '', value: 0 };
    case 'wait':
      return { amount: 1, unit: 'hours' };
    case 'condition':
      return { subject: 'tag_presence', operand: '', value: '' };
    case 'send_webhook':
      return { url: '', headers: {}, body_template: '' };
    case 'close_conversation':
      return {};
    case 'move_deal_stage':
      return { stage_id: '' };
    case 'update_deal':
      return { field: 'notes', value: '' };
    case 'cancel_automations':
      return { scope: 'deal', automation_ids: [] };
    case 'end':
      return { reason: '' };
    default:
      return {};
  }
}

// ------------------------------------------------------------
// Account resources (tags, members, approved templates, pipelines)
//
// Loaded once at the builder root and shared via context so the
// tag / agent / template pickers below can offer existing resources
// by name instead of asking the user to paste raw UUIDs. Every picker
// falls back to a raw input when its list is empty (fresh account or
// an older deployment), so an automation is always authorable.
// ------------------------------------------------------------

interface AutomationResources {
  tags: TagRecord[];
  members: AccountMember[];
  templates: MessageTemplate[];
  customFields: CustomField[];
  pipelines: PipelineOption[];
  stages: PipelineStageOption[];
  /** For the team_message_sent trigger — `/aberto` by name, not by id. */
  quickReplies: QuickReply[];
  /** For the cancel_automations step. */
  automations: AutomationOption[];
}

interface PipelineOption {
  id: string;
  name: string;
}

interface AutomationOption {
  id: string;
  name: string;
}

interface PipelineStageOption {
  id: string;
  name: string;
  pipeline_id: string;
  position: number;
}

const ResourcesContext = createContext<AutomationResources>({
  tags: [],
  members: [],
  templates: [],
  customFields: [],
  pipelines: [],
  stages: [],
  quickReplies: [],
  automations: [],
});

function useResources(): AutomationResources {
  return useContext(ResourcesContext);
}

function ResourcesProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [stages, setStages] = useState<PipelineStageOption[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [automations, setAutomations] = useState<AutomationOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    // Tags, templates and custom fields come straight from the DB — RLS
    // scopes them to the caller's account. Only APPROVED templates can
    // actually be sent (anything else 400s at send time), matching the
    // broadcast picker.
    void (async () => {
      const [
        tagsRes,
        templatesRes,
        customFieldsRes,
        pipelinesRes,
        stagesRes,
        automationsRes,
      ] = await Promise.all([
        supabase.from('tags').select('*').order('name'),
        supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('name'),
        supabase.from('custom_fields').select('*').order('field_name'),
        supabase.from('pipelines').select('id, name').order('name'),
        supabase
          .from('pipeline_stages')
          .select('id, name, pipeline_id, position')
          .order('position'),
        supabase.from('automations').select('id, name').order('name'),
      ]);
      if (cancelled) return;
      setTags((tagsRes.data as TagRecord[] | null) ?? []);
      setTemplates((templatesRes.data as MessageTemplate[] | null) ?? []);
      setCustomFields((customFieldsRes.data as CustomField[] | null) ?? []);
      setPipelines((pipelinesRes.data as PipelineOption[] | null) ?? []);
      setStages((stagesRes.data as PipelineStageOption[] | null) ?? []);
      setAutomations((automationsRes.data as AutomationOption[] | null) ?? []);
    })();

    // Quick replies go through their API, which is what the composer's
    // `/` panel reads too — so the trigger picker and the panel agree on
    // what a snippet is called.
    void (async () => {
      try {
        const res = await fetch('/api/quick-replies', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { quick_replies?: QuickReply[] };
        if (!cancelled) setQuickReplies(json.quick_replies ?? []);
      } catch {
        // Endpoint absent — the trigger falls back to a raw id input.
      }
    })();

    // Members go through the API so we inherit its email-visibility
    // rules (agents/viewers don't see emails). Unreachable on older
    // deployments → pickers fall back to a raw agent-id input.
    void (async () => {
      try {
        const res = await fetch('/api/account/members', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { members?: AccountMember[] };
        if (!cancelled) setMembers(json.members ?? []);
      } catch {
        // Members endpoint absent — caller falls back to raw input.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ResourcesContext.Provider
      value={{
        tags,
        members,
        templates,
        customFields,
        pipelines,
        stages,
        quickReplies,
        automations,
      }}
    >
      {children}
    </ResourcesContext.Provider>
  );
}

// Every select in this builder sits on the panel's muted surface; the border,
// height, padding and chevron all belong to `NativeSelect` itself. This is the
// only thing left that is local to the builder.
const SELECT_CLASS = 'bg-muted';

/** Tag dropdown by name + color, storing the tag's id. Falls back to a
 *  raw id input when no tags exist yet. */
function TagSelect({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { tags } = useResources();
  if (tags.length === 0) {
    return (
      <Input
        placeholder={t('tags.placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    );
  }
  const selected = tags.find((t) => t.id === value);
  return (
    <div className="flex items-center gap-2">
      <span
        className="border-border h-3 w-3 shrink-0 rounded-full border"
        style={{ backgroundColor: selected?.color ?? 'transparent' }}
        aria-hidden
      />
      <OptionSelect
        value={value}
        onValueChange={onChange}
        className={SELECT_CLASS}
      >
        <option value="">{t('tags.select')}</option>
        {tags.map((tg) => (
          <option key={tg.id} value={tg.id}>
            {tg.name}
          </option>
        ))}
        {/* Preserve a saved tag that's since been deleted so editing an
            existing automation doesn't silently drop it. */}
        {value && !selected && (
          <option value={value}>{t('tags.unknown', { id: value })}</option>
        )}
      </OptionSelect>
    </div>
  );
}

/** Contact-field dropdown for "Update Contact Field": built-in columns plus
 *  any account custom fields (stored as `custom:<id>`). A saved custom field
 *  that's since been deleted is preserved as a labelled option so editing an
 *  existing automation doesn't silently drop it. */
function ContactFieldSelect({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { customFields } = useResources();
  const customValue = value.startsWith('custom:') ? value : '';
  const knownCustom =
    customValue && customFields.some((f) => `custom:${f.id}` === customValue);
  return (
    <OptionSelect
      value={value || 'name'}
      onValueChange={onChange}
      className={SELECT_CLASS}
    >
      <option value="name">{t('fields.name')}</option>
      <option value="email">{t('fields.email')}</option>
      <option value="company">{t('fields.company')}</option>
      {customFields.length > 0 && (
        <optgroup label={t('fields.customFields')}>
          {customFields.map((f) => (
            <option key={f.id} value={`custom:${f.id}`}>
              {f.field_name}
            </option>
          ))}
        </optgroup>
      )}
      {customValue && !knownCustom && (
        <option value={customValue}>
          {t('fields.unknown', { id: customValue })}
        </option>
      )}
    </OptionSelect>
  );
}

/** Agent dropdown by name, storing the member's user_id. Falls back to
 *  a raw id input when the member list is unavailable. */
function AgentSelect({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { members } = useResources();
  if (members.length === 0) {
    return (
      <Input
        placeholder={t('agents.placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    );
  }
  const selected = members.find((m) => m.user_id === value);
  return (
    <OptionSelect
      value={value}
      onValueChange={onChange}
      className={SELECT_CLASS}
    >
      <option value="">{t('agents.select')}</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.full_name || m.email || m.user_id}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>{t('agents.unknown', { id: value })}</option>
      )}
    </OptionSelect>
  );
}

/** Quick-reply dropdown by shortcut and title, storing the snippet's id.
 *  Falls back to a raw id input when the list is unavailable. */
function QuickReplySelect({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { quickReplies } = useResources();
  if (quickReplies.length === 0) {
    return (
      <Input
        placeholder={t('quickReplies.placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    );
  }
  const selected = quickReplies.find((q) => q.id === value);
  return (
    <OptionSelect
      value={value}
      onValueChange={onChange}
      className={SELECT_CLASS}
    >
      <option value="">{t('quickReplies.select')}</option>
      {quickReplies.map((q) => (
        <option key={q.id} value={q.id}>
          {q.shortcut ? `/${q.shortcut} — ${q.title}` : q.title}
        </option>
      ))}
      {value && !selected && (
        <option value={value}>
          {t('quickReplies.unknown', { id: value })}
        </option>
      )}
    </OptionSelect>
  );
}

/** Every stage of the account, grouped by funnel, storing the stage id.
 *  Used where the funnel is implied by the run (move_deal_stage) rather
 *  than chosen first (create_deal). */
function StageSelect({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { pipelines, stages } = useResources();
  if (stages.length === 0) {
    return (
      <Input
        placeholder={t('pipelines.stageIdLabel')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground"
      />
    );
  }
  const known = stages.some((s) => s.id === value);
  return (
    <OptionSelect
      value={value}
      onValueChange={onChange}
      className={SELECT_CLASS}
    >
      <option value="">{t('pipelines.selectStage')}</option>
      {pipelines.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {stages
            .filter((s) => s.pipeline_id === p.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </optgroup>
      ))}
      {value && !known && (
        <option value={value}>
          {t('pipelines.unknownStage', { id: value })}
        </option>
      )}
    </OptionSelect>
  );
}

/**
 * A list of stages to tick — the shape a rule like "cancel when the deal
 * enters any of these" needs. `pipelineId` narrows the list to one
 * funnel; without it every funnel is offered, grouped.
 */
function StageChecklist({
  value,
  onChange,
  pipelineId,
  t,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  pipelineId?: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const { pipelines, stages } = useResources();
  const visible = pipelineId
    ? pipelines.filter((p) => p.id === pipelineId)
    : pipelines;
  const toggle = (id: string) =>
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  if (stages.length === 0) {
    return (
      <p className="text-muted-foreground text-2xs leading-relaxed">
        {t('pipelines.selectPipelineFirst')}
      </p>
    );
  }
  const unknown = value.filter((id) => !stages.some((s) => s.id === id));
  return (
    <div className="space-y-2">
      {visible.map((p) => (
        <div key={p.id}>
          {!pipelineId && (
            <div className="text-muted-foreground eyebrow mb-1">{p.name}</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {stages
              .filter((s) => s.pipeline_id === p.id)
              .map((s) => {
                const on = value.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.id)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs transition-colors',
                      on
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-border bg-muted text-secondary-foreground hover:text-foreground'
                    )}
                  >
                    {s.name}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      {unknown.length > 0 && (
        <p className="text-muted-foreground text-2xs">
          {t('pipelines.unknownStage', { id: unknown.join(', ') })}
        </p>
      )}
    </div>
  );
}

/** Which automations a cancel step reaches. Empty means all the others. */
function AutomationChecklist({
  value,
  onChange,
  t,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { automations } = useResources();
  const toggle = (id: string) =>
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-2xs leading-relaxed">
        {t('config.allOtherAutomations')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {automations.map((a) => {
          const on = value.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(a.id)}
              className={cn(
                'rounded-md border px-2 py-1 text-xs transition-colors',
                on
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border bg-muted text-secondary-foreground hover:text-foreground'
              )}
            >
              {a.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pipeline + stage picker for Create Deal. The automation stores ids because
 *  the engine writes directly to deals, but authors should choose by name. */
function DealPipelineFields({
  pipelineId,
  stageId,
  onChange,
  t,
}: {
  pipelineId: string;
  stageId: string;
  onChange: (patch: { pipeline_id: string; stage_id: string }) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { pipelines, stages } = useResources();

  if (pipelines.length === 0) {
    return (
      <>
        <FieldBlock label={t('pipelines.pipelineIdLabel')}>
          <Input
            value={pipelineId}
            onChange={(e) =>
              onChange({ pipeline_id: e.target.value, stage_id: stageId })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t('pipelines.stageIdLabel')}>
          <Input
            value={stageId}
            onChange={(e) =>
              onChange({ pipeline_id: pipelineId, stage_id: e.target.value })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    );
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);
  const stageOptions = stages.filter((s) => s.pipeline_id === pipelineId);
  const selectedStage = stageOptions.find((s) => s.id === stageId);

  return (
    <>
      <FieldBlock label={t('pipelines.pipelineLabel')}>
        <OptionSelect
          value={pipelineId}
          onValueChange={(nextPipelineId) => {
            const firstStage = stages.find(
              (s) => s.pipeline_id === nextPipelineId
            );
            onChange({
              pipeline_id: nextPipelineId,
              stage_id: firstStage?.id ?? '',
            });
          }}
          className={SELECT_CLASS}
        >
          <option value="">{t('pipelines.selectPipeline')}</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {pipelineId && !selectedPipeline && (
            <option value={pipelineId}>
              {t('pipelines.unknownPipeline', { id: pipelineId })}
            </option>
          )}
        </OptionSelect>
      </FieldBlock>
      <FieldBlock label={t('pipelines.stageLabel')}>
        <OptionSelect
          value={stageId}
          onValueChange={(stage) =>
            onChange({ pipeline_id: pipelineId, stage_id: stage })
          }
          className={SELECT_CLASS}
          disabled={!pipelineId || stageOptions.length === 0}
        >
          <option value="">
            {pipelineId
              ? t('pipelines.selectStage')
              : t('pipelines.selectPipelineFirst')}
          </option>
          {stageOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {stageId && pipelineId && !selectedStage && (
            <option value={stageId}>
              {t('pipelines.unknownStage', { id: stageId })}
            </option>
          )}
        </OptionSelect>
      </FieldBlock>
    </>
  );
}

/** Template dropdown showing approved templates by name + language,
 *  storing both template_name and language. Falls back to manual name +
 *  language inputs when no approved templates are synced yet. */
function SendTemplateFields({
  templateName,
  language,
  onChange,
  t,
}: {
  templateName: string;
  language: string;
  onChange: (patch: { template_name: string; language: string }) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { templates } = useResources();

  if (templates.length === 0) {
    return (
      <>
        <FieldBlock label={t('templates.templateNameLabel')}>
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
        <FieldBlock label={t('templates.languageLabel')}>
          <Input
            value={language}
            onChange={(e) =>
              onChange({
                template_name: templateName,
                language: e.target.value,
              })
            }
            className="bg-muted text-foreground"
          />
        </FieldBlock>
      </>
    );
  }

  // Encode name + language in the option value so two templates that
  // share a name across languages stay distinct.
  const toValue = (name: string, lang: string) => `${name}::${lang}`;
  const current = templateName ? toValue(templateName, language) : '';
  const hasMatch = templates.some(
    (t) => toValue(t.name, t.language ?? 'en_US') === current
  );

  return (
    <FieldBlock label={t('templates.templateLabel')}>
      <OptionSelect
        value={current}
        onValueChange={(selected) => {
          const [name, lang] = selected.split('::');
          onChange({ template_name: name ?? '', language: lang ?? '' });
        }}
        className={SELECT_CLASS}
      >
        <option value="">{t('templates.select')}</option>
        {templates.map((tmpl) => {
          const lang = tmpl.language ?? 'en_US';
          return (
            <option key={tmpl.id} value={toValue(tmpl.name, lang)}>
              {tmpl.name} ({lang})
            </option>
          );
        })}
        {current && !hasMatch && (
          <option value={current}>
            {t('templates.unknown', {
              name: templateName,
              lang: language || t('templates.unknownLang'),
            })}
          </option>
        )}
      </OptionSelect>
    </FieldBlock>
  );
}

// ------------------------------------------------------------
// Main builder component
// ------------------------------------------------------------

export function AutomationBuilder({ initial }: { initial: BuilderInitial }) {
  const router = useRouter();
  const t = useTranslations('Automations.builder');
  const isEditing = !!initial.id;
  const [state, setState] = useState<BuilderInitial>(initial);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function patchTop<K extends keyof BuilderInitial>(
    key: K,
    value: BuilderInitial[K]
  ) {
    setState((s) => ({ ...s, [key]: value }));
  }

  // --- Step tree mutations (immutable) ---

  function updateStep(
    path: StepPath,
    updater: (s: BuilderStep) => BuilderStep
  ) {
    setState((s) => ({ ...s, steps: mapAtPath(s.steps, path, updater) }));
  }

  function addStepAt(
    parent: ParentScope,
    index: number,
    type: AutomationStepType
  ) {
    const node: BuilderStep = {
      cid: cid(),
      step_type: type,
      step_config: blankConfig(type),
      branches: type === 'condition' ? { yes: [], no: [] } : undefined,
    };
    setState((s) => ({ ...s, steps: insertAt(s.steps, parent, index, node) }));
    setExpandedId(node.cid);
  }

  function deleteStepAt(path: StepPath) {
    setState((s) => ({ ...s, steps: removeAt(s.steps, path) }));
  }

  function moveStepAt(path: StepPath, direction: -1 | 1) {
    setState((s) => ({ ...s, steps: moveAt(s.steps, path, direction) }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        // Same word the empty name field shows as its placeholder, so an
        // automation saved without a name reads the same in the list as it
        // did in the editor — and in the right language.
        name: state.name || t('untitled'),
        description: state.description || null,
        trigger_type: state.trigger_type,
        trigger_config: state.trigger_config,
        is_active: state.is_active,
        steps: toApiSteps(state.steps),
        // The rules of migration 065. Sent whole, every save.
        pipeline_id: state.pipeline_id || null,
        cancel_on_reply: state.cancel_on_reply,
        cancel_when_stage_in: state.cancel_when_stage_in,
        reentry_policy: state.reentry_policy,
        reentry_days:
          state.reentry_policy === 'after_days' ? state.reentry_days : null,
      };

      const res = isEditing
        ? await fetch(`/api/automations/${initial.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/automations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If the server blocked activation with validation issues,
        // surface the first concrete problem so the user can fix it
        // without opening DevTools for the full array.
        const firstIssue: { path?: string; message?: string } | undefined =
          body?.issues?.[0];
        if (firstIssue?.message) {
          toast.error(firstIssue.message, {
            description: firstIssue.path ? `at ${firstIssue.path}` : undefined,
          });
        } else {
          toast.error(body?.error ?? t('toasts.saveFailed'));
        }
        return;
      }
      toast.success(isEditing ? t('toasts.saved') : t('toasts.created'));
      // Saved, but with something that will bite at runtime — a plain
      // message a day after a wait, say. Said once, here, not refused.
      const warning: { message?: string } | undefined = body?.warnings?.[0];
      if (warning?.message) {
        toast.warning(warning.message, { duration: 8000 });
      }
      if (!isEditing && body?.automation?.id) {
        router.replace(`/automations/${body.automation.id}/edit`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    // An in-flow, full-height column — NOT `fixed inset-0`, which is what
    // this was and why the canvas was invisible. `fixed` resolves against
    // the nearest transformed ancestor, and every page in this app sits
    // inside one (the entrance animation left a transform behind), so the
    // editor was sizing itself to a wrapper whose only child was the
    // editor: 0px tall. The toolbar overflowed and showed; the canvas,
    // being `flex-1` of nothing, did not. The shell hands app-shaped
    // routes a real height now — see dashboard-shell.tsx.
    // `editor-grid` on the ROOT, so the paper runs behind the toolbar too.
    // The header keeps a translucent fill of its own so the controls stay
    // readable over the dots.
    //
    // NOT what the flow editor does, despite what this comment used to
    // claim: there the grid is on the canvas wrapper and stops below the
    // toolbar. Same utility, same 22px spacing, different reach. Written
    // down because a comment asserting a parity that was never built is
    // how the next person "fixes" the wrong file.
    <div className="editor-grid flex min-h-0 flex-1 flex-col">
      {/* Top bar. At sub-sm widths the "Active" label is hidden and the
          switch moves to the right of the save button, so the name input
          gets maximum width. */}
      <header className="border-border bg-card/80 flex flex-shrink-0 items-center gap-2 border-b px-4 py-3 backdrop-blur-sm sm:gap-3 sm:px-6 lg:px-8">
        {/* A <Button>, not a bare <button>: the coarse-pointer 44px shield
            in globals.css keys off [data-slot="button"], and 36px is the
            only way out of a full-screen editor on a phone. */}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => router.push('/automations')}
          aria-label={t('backToAutomations')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <input
          value={state.name}
          onChange={(e) => patchTop('name', e.target.value)}
          placeholder={t('untitled')}
          className="text-foreground placeholder:text-muted-foreground focus-visible:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-semibold outline-none focus-visible:ring-3 sm:text-base"
        />
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="hidden sm:inline">{t('active')}</span>
          <Switch
            checked={state.is_active}
            onCheckedChange={(v) => patchTop('is_active', !!v)}
            aria-label={t('activeAria')}
          />
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEditing ? t('save') : t('saveDraft')}
        </Button>
      </header>

      {/* Canvas */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-0 px-4 py-10">
          <ResourcesProvider>
            <TriggerCard
              type={state.trigger_type}
              config={state.trigger_config}
              onTypeChange={(tVal) => patchTop('trigger_type', tVal)}
              onConfigChange={(c) => patchTop('trigger_config', c)}
              t={t}
            />
            <RulesCard
              state={state}
              onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
              t={t}
            />
            <StepList
              steps={state.steps}
              basePath={[]}
              scope={{ kind: 'root' }}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              updateStep={updateStep}
              addStepAt={addStepAt}
              deleteStepAt={deleteStepAt}
              moveStepAt={moveStepAt}
            />
          </ResourcesProvider>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Trigger card
// ------------------------------------------------------------

function TriggerCard({
  type,
  config,
  onTypeChange,
  onConfigChange,
  t,
}: {
  type: AutomationTriggerType;
  config: Record<string, unknown>;
  onTypeChange: (t: AutomationTriggerType) => void;
  onConfigChange: (c: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);
  // The picker's list, plus whatever this automation already uses — so a
  // row saved with a trigger the picker no longer offers still opens on
  // the trigger it has rather than on the first one in the list.
  const options = TRIGGER_OPTIONS.some((o) => o.value === type)
    ? TRIGGER_OPTIONS
    : [...TRIGGER_OPTIONS, { value: type }];
  return (
    // Card width: full on mobile, fixed 320px on sm+. The canvas wrapper
    // (max-w-2xl + px-4) keeps this tidy on tablet/desktop.
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      {/* Same geometry and same shadow as a step card — this used to be
          `shadow-lg` next to a column of `shadow-sm` cards, which read as
          the trigger floating on a different plane. The left rule stays:
          it is the one card that is the start of the flow rather than a
          part of it. */}
      <div className="border-border border-l-primary bg-card overflow-hidden rounded-lg border border-l-4 shadow-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="bg-primary-soft text-primary grid size-8 shrink-0 place-items-center rounded-md">
            <Zap className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-primary eyebrow">{t('trigger')}</div>
            <div className="text-foreground truncate text-sm font-medium">
              {t(`triggers.${type}.label`)}
            </div>
          </div>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform duration-(--dur-2)',
              open && 'rotate-180'
            )}
          />
        </button>
        {open && (
          <div className="border-border space-y-3 border-t px-4 py-3">
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                {t('triggerType')}
              </label>
              <OptionSelect
                value={type}
                onValueChange={(next) =>
                  onTypeChange(next as AutomationTriggerType)
                }
                className="bg-muted"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(`triggers.${o.value}.label`)}
                  </option>
                ))}
              </OptionSelect>
              <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
                {t(`triggers.${type}.hint`)}
              </p>
            </div>
            {type === 'keyword_match' && (
              <KeywordMatchConfig
                config={config as unknown as KeywordMatchTriggerConfig}
                onChange={onConfigChange}
                t={t}
              />
            )}
            {type === 'interactive_reply' && (
              <InteractiveReplyConfig
                config={config}
                onChange={onConfigChange}
                t={t}
              />
            )}
            {type === 'tag_added' && (
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t('config.tagLabel')}
                </label>
                <TagSelect
                  value={(config.tag_id as string) ?? ''}
                  onChange={(v) => onConfigChange({ ...config, tag_id: v })}
                  t={t}
                />
              </div>
            )}
            {type === 'time_based' && (
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t('schedule')}
                </label>
                <Input
                  placeholder={t('schedulePlaceholder')}
                  value={(config.schedule as string) ?? ''}
                  onChange={(e) =>
                    onConfigChange({ ...config, schedule: e.target.value })
                  }
                  className="bg-muted text-foreground"
                />
                <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
                  {t('scheduleHint')}
                </p>
              </div>
            )}
            {type === 'deal_stage_entered' && (
              <DealPipelineFields
                pipelineId={(config.pipeline_id as string) ?? ''}
                stageId={(config.stage_id as string) ?? ''}
                onChange={(patch) => onConfigChange({ ...config, ...patch })}
                t={t}
              />
            )}
            {type === 'team_message_sent' && (
              <>
                <FieldBlock label={t('config.quickReplyLabel')}>
                  <QuickReplySelect
                    value={(config.quick_reply_id as string) ?? ''}
                    onChange={(v) =>
                      onConfigChange({ ...config, quick_reply_id: v })
                    }
                    t={t}
                  />
                </FieldBlock>
                <FieldBlock label={t('config.templateOrLabel')}>
                  <Input
                    value={(config.template_name as string) ?? ''}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        template_name: e.target.value.trim(),
                      })
                    }
                    placeholder="orcamento_enviado"
                    className="bg-muted text-foreground font-mono"
                  />
                </FieldBlock>
              </>
            )}
            {type === 'date_field_reached' && (
              <>
                <FieldBlock label={t('config.dateFieldLabel')}>
                  <OptionSelect
                    value={(config.field as string) ?? 'birthday'}
                    onValueChange={(field) =>
                      onConfigChange({ ...config, field })
                    }
                    className="bg-muted"
                  >
                    <option value="birthday">
                      {t('config.dateFields.birthday')}
                    </option>
                    <option value="next_purchase_expected_at">
                      {t('config.dateFields.next_purchase_expected_at')}
                    </option>
                    <option value="last_purchase_at">
                      {t('config.dateFields.last_purchase_at')}
                    </option>
                  </OptionSelect>
                </FieldBlock>
                <FieldBlock label={t('config.atLabel')}>
                  <Input
                    value={(config.at as string) ?? '09:00'}
                    onChange={(e) =>
                      onConfigChange({ ...config, at: e.target.value })
                    }
                    placeholder="09:00"
                    className="bg-muted text-foreground"
                  />
                </FieldBlock>
                <FieldBlock label={t('config.timezoneLabel')}>
                  <Input
                    value={(config.timezone as string) ?? ''}
                    onChange={(e) =>
                      onConfigChange({ ...config, timezone: e.target.value })
                    }
                    placeholder="America/Sao_Paulo"
                    className="bg-muted text-foreground"
                  />
                </FieldBlock>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Rules card — the funnel, the cancellation rules, the reentry policy
// (migration 065). Sits between the trigger and the first step: they are
// properties of the whole automation, applied by the engine on its own,
// not steps in the list.
// ------------------------------------------------------------

function RulesCard({
  state,
  onChange,
  t,
}: {
  state: BuilderInitial;
  onChange: (patch: Partial<BuilderInitial>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);
  const { pipelines } = useResources();
  const activeRules =
    (state.cancel_on_reply ? 1 : 0) +
    (state.cancel_when_stage_in.length > 0 ? 1 : 0) +
    (state.reentry_policy !== 'always' ? 1 : 0) +
    (state.pipeline_id ? 1 : 0);
  const selectedPipeline = pipelines.find((p) => p.id === state.pipeline_id);

  return (
    <div className="z-10 w-full max-w-[320px] sm:w-80">
      <div className="bg-border mx-auto h-4 w-[2px]" aria-hidden />
      <div className="border-border bg-card overflow-hidden rounded-lg border shadow-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="bg-muted text-secondary-foreground grid size-8 shrink-0 place-items-center rounded-md">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-secondary-foreground eyebrow">
              {t('rules.title')}
            </div>
            <div className="text-foreground truncate text-sm font-medium">
              {activeRules === 0
                ? t('rules.none')
                : t('rules.count', { count: activeRules })}
            </div>
          </div>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform duration-(--dur-2)',
              open && 'rotate-180'
            )}
          />
        </button>
        {open && (
          <div className="border-border space-y-3 border-t px-4 py-3">
            <FieldBlock label={t('rules.pipelineLabel')}>
              <OptionSelect
                value={state.pipeline_id ?? ''}
                onValueChange={(v) => onChange({ pipeline_id: v || null })}
                className="bg-muted"
              >
                <option value="">{t('rules.pipelineAny')}</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {state.pipeline_id && !selectedPipeline && (
                  <option value={state.pipeline_id}>
                    {t('pipelines.unknownPipeline', { id: state.pipeline_id })}
                  </option>
                )}
              </OptionSelect>
              <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
                {t('rules.pipelineHint')}
              </p>
            </FieldBlock>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-foreground text-xs font-medium">
                  {t('rules.cancelOnReply')}
                </div>
                <p className="text-muted-foreground text-2xs mt-0.5 leading-relaxed">
                  {t('rules.cancelOnReplyHint')}
                </p>
              </div>
              <Switch
                checked={state.cancel_on_reply}
                onCheckedChange={(v) => onChange({ cancel_on_reply: !!v })}
                aria-label={t('rules.cancelOnReply')}
              />
            </div>

            <FieldBlock label={t('rules.cancelWhenStageIn')}>
              <p className="text-muted-foreground text-2xs mb-2 leading-relaxed">
                {t('rules.cancelWhenStageInHint')}
              </p>
              <StageChecklist
                value={state.cancel_when_stage_in}
                onChange={(next) => onChange({ cancel_when_stage_in: next })}
                pipelineId={state.pipeline_id}
                t={t}
              />
            </FieldBlock>

            <FieldBlock label={t('rules.reentryLabel')}>
              <OptionSelect
                value={state.reentry_policy}
                onValueChange={(v) =>
                  onChange({ reentry_policy: v as AutomationReentryPolicy })
                }
                className="bg-muted"
              >
                <option value="always">{t('rules.reentry.always')}</option>
                <option value="after_complete">
                  {t('rules.reentry.after_complete')}
                </option>
                <option value="never">{t('rules.reentry.never')}</option>
                <option value="after_days">
                  {t('rules.reentry.after_days')}
                </option>
              </OptionSelect>
              {state.reentry_policy === 'after_days' && (
                <Input
                  type="number"
                  min={1}
                  value={state.reentry_days ?? 30}
                  onChange={(e) =>
                    onChange({
                      reentry_days: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="bg-muted text-foreground mt-2"
                  aria-label={t('rules.reentryDays')}
                />
              )}
              <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
                {t('rules.reentryHint')}
              </p>
            </FieldBlock>
          </div>
        )}
      </div>
    </div>
  );
}

function KeywordMatchConfig({
  config,
  onChange,
  t,
}: {
  config: KeywordMatchTriggerConfig;
  onChange: (c: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const keywords = config?.keywords ?? [];
  // Keep a local draft string so the comma and trailing space aren't
  // stripped on every keystroke (which made multi-word, comma-separated
  // entry like "SEO, search engine optimization" impossible to type).
  // We only parse into the keywords array on blur, then re-display the
  // cleaned, rejoined form. Seeded once on mount; this component remounts
  // when the trigger type changes, so the seed stays in sync.
  const [draft, setDraft] = useState(keywords.join(', '));

  // Persist the default the <select> displays. The dropdown falls back to
  // "contains" for display, but leaving it untouched would otherwise omit
  // match_type from the saved config — and activation validation then
  // rejected it (trigger.match_type). Seed once on mount; the component
  // remounts when the trigger type changes, matching the keywords draft.
  useEffect(() => {
    if (config?.match_type == null) {
      onChange({ ...config, match_type: 'contains' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit() {
    const parsed = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setDraft(parsed.join(', '));
    onChange({ ...config, keywords: parsed });
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t('keywords')}
        </label>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={t('keywordsHint')}
          className="bg-muted text-foreground"
        />
      </div>
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t('config.matchType')}
        </label>
        <OptionSelect
          value={config?.match_type ?? 'contains'}
          onValueChange={(match) =>
            onChange({
              ...config,
              match_type: match as 'exact' | 'contains' | 'word',
            })
          }
          className="bg-muted"
        >
          <option value="contains">{t('config.matchContains')}</option>
          <option value="word">{t('config.matchWord')}</option>
          <option value="exact">{t('config.matchExact')}</option>
        </OptionSelect>
        {/* Only worth explaining for `word` — "contains" and "exact" read
            for themselves, and this is the one that changes which messages
            fire an automation in a way that isn't obvious. */}
        {config?.match_type === 'word' && (
          <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
            {t('config.matchWordHint')}
          </p>
        )}
      </div>
    </div>
  );
}

function InteractiveReplyConfig({
  config,
  onChange,
  t,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const ids = (config?.reply_ids as string[] | undefined) ?? [];
  // Same local-draft-then-commit pattern as KeywordMatchConfig so
  // commas + spaces survive keystrokes.
  const [draft, setDraft] = useState(ids.join(', '));

  function commit() {
    const parsed = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setDraft(parsed.join(', '));
    onChange({ ...config, reply_ids: parsed });
  }

  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-xs font-medium">
        {t('replyIds')}
      </label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={t('replyIdsHint')}
        className="bg-muted text-foreground font-mono"
      />
      <p className="text-muted-foreground text-2xs mt-1 leading-relaxed">
        {t('replyIdsHelp')}
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// Step list + card + connectors
// ------------------------------------------------------------

interface StepListProps {
  steps: BuilderStep[];
  /**
   * Path of the step that owns this list — `[]` for the root canvas,
   * the condition's own path for a branch column. Combined with
   * `scope` by `childPath` to address each child.
   */
  basePath: StepPath;
  /** Which bucket this list reads and writes. */
  scope: ParentScope;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  updateStep: (
    path: StepPath,
    updater: (s: BuilderStep) => BuilderStep
  ) => void;
  addStepAt: (
    parent: ParentScope,
    index: number,
    type: AutomationStepType
  ) => void;
  deleteStepAt: (path: StepPath) => void;
  moveStepAt: (path: StepPath, direction: -1 | 1) => void;
}

function StepList(props: StepListProps) {
  const { steps, basePath, scope, ...rest } = props;

  return (
    <div className="flex w-full flex-col items-center">
      <AddButton onPick={(t) => props.addStepAt(scope, 0, t)} />
      {steps.map((step, idx) => (
        <StepRenderer
          key={step.cid}
          step={step}
          index={idx}
          total={steps.length}
          basePath={basePath}
          scope={scope}
          {...rest}
        />
      ))}
    </div>
  );
}

function StepRenderer({
  step,
  index,
  total,
  scope,
  basePath,
  ...props
}: {
  step: BuilderStep;
  index: number;
  total: number;
  scope: ParentScope;
  basePath: StepPath;
} & Omit<StepListProps, 'steps' | 'basePath' | 'scope'>) {
  const t = useTranslations('Automations.builder');
  const resources = useResources();
  const path = childPath(basePath, scope, index);
  const meta = STEP_META[step.step_type];
  const Icon = meta.icon;
  const kindStyle = KIND_STYLE[meta.kind];
  const expanded = props.expandedId === step.cid;
  const isCondition = step.step_type === 'condition';
  const nested = basePath.length > 0;
  // Card widths on mobile fill the full canvas column (max-w-2xl px-4
  // still keeps them reasonable). On sm+ fixed widths come back so the
  // flow visual stays recognisable — but only at the top level: a
  // branch column is a fraction of its condition's width, so a 320px
  // card inside one overflowed its own column and dragged the editor's
  // controls out of reach (issue #474). Nested cards fill the column
  // they were given instead.
  //
  // A condition is wider than a plain step because it has to hold two
  // branch columns side by side; 600px (the canvas is max-w-2xl, i.e.
  // 640px of content) leaves each branch ~294px — near enough to the
  // 320px a step gets at the top level for the same editors to fit.
  const width = nested
    ? 'w-full'
    : isCondition
      ? 'w-full max-w-[600px] sm:w-[600px]'
      : 'w-full max-w-[320px] sm:w-80';

  return (
    <>
      <div className={cn('z-10 flex min-w-0 flex-col', width)}>
        <div className="border-border bg-card overflow-hidden rounded-lg border shadow-sm">
          <button
            type="button"
            onClick={() => props.setExpandedId(expanded ? null : step.cid)}
            className={cn(
              'border-border flex w-full items-center gap-2.5 border-b px-3 py-2 text-left',
              kindStyle.head
            )}
          >
            <GripVertical
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden
            />
            <div
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-md',
                kindStyle.icon
              )}
            >
              <Icon className="size-3.5" />
            </div>
            <span className={cn('eyebrow shrink-0', kindStyle.label)}>
              {t(`kinds.${meta.kind}`)}
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
              {t(`steps.${meta.label}`)}
            </span>
            <ChevronDown
              className={cn(
                'text-muted-foreground size-4 shrink-0 transition-transform duration-(--dur-2)',
                expanded && 'rotate-180'
              )}
            />
          </button>
          {/* The one-line summary moves under the head, where it has the full
              width. Wedged into the title row it truncated after four words
              and told you nothing about the step. */}
          <div className="border-border text-muted-foreground text-2xs truncate border-b px-3 py-1.5">
            {previewFor(step, t, resources)}
          </div>
          {expanded && (
            <div className="px-3 py-3">
              <StepEditor
                step={step}
                onChange={(next) => props.updateStep(path, () => next)}
              />
              <div className="border-border mt-3 flex items-center justify-between gap-2 border-t pt-3">
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label={t('moveUp')}
                    onClick={() => props.moveStepAt(path, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={index === total - 1}
                    aria-label={t('moveDown')}
                    onClick={() => props.moveStepAt(path, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => props.deleteStepAt(path)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('delete')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {isCondition && (
          <ConditionBranches step={step} path={path} {...props} />
        )}
      </div>

      {/* A condition branches into Yes/No (rendered above by
          ConditionBranches), so it has no linear "continue" path — adding
          the trailing connector here would produce a spurious third output. */}
      {!isCondition && (
        <AddButton onPick={(t) => props.addStepAt(scope, index + 1, t)} />
      )}
    </>
  );
}

function ConditionBranches({
  step,
  path,
  ...props
}: {
  step: BuilderStep;
  /** The condition's OWN path. Children hang off it, one marker each. */
  path: StepPath;
} & Omit<StepListProps, 'steps' | 'basePath' | 'scope'>) {
  const t = useTranslations('Automations.builder');
  const yes = step.branches?.yes ?? [];
  const no = step.branches?.no ?? [];
  return (
    // Stack Yes/No vertically until THIS CARD is wide enough for two
    // columns. A viewport breakpoint can't tell: a condition nested in
    // a branch is a fraction of the screen, and `sm:grid-cols-2` split
    // it anyway, leaving two columns too narrow to render a step in.
    <div className="@container mt-3 w-full">
      <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
        {/* Yes / No is structure, not state, so it separates by emphasis
            rather than hue. It used to be blue vs `text-rose-400` — a raw
            Tailwind pink the theme never remaps, at ~2.5:1 on the light
            card, spending a red on a branch that has not failed. */}
        <BranchColumn label={t('branches.yes')} color="text-foreground">
          <StepList
            {...props}
            steps={yes}
            basePath={path}
            scope={{ kind: 'branch', parentCid: step.cid, branch: 'yes' }}
          />
        </BranchColumn>
        <BranchColumn label={t('branches.no')} color="text-muted-foreground">
          <StepList
            {...props}
            steps={no}
            basePath={path}
            scope={{ kind: 'branch', parentCid: step.cid, branch: 'no' }}
          />
        </BranchColumn>
      </div>
    </div>
  );
}

function BranchColumn({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center">
      {/* `eyebrow` and not a hand-rolled uppercase: this one had no
          tracking at all, so it inherited the body's -0.006em — uppercase
          with NEGATIVE letter-spacing, the one thing the form cannot take. */}
      <div className={cn('eyebrow mb-2', color)}>{label}</div>
      {children}
    </div>
  );
}

function AddButton({ onPick }: { onPick: (t: AutomationStepType) => void }) {
  const t = useTranslations('Automations.builder');
  return (
    <div className="relative flex flex-col items-center">
      <div className="bg-border h-4 w-[2px]" aria-hidden />
      <DropdownMenu>
        {/* 32px is the "add a step" target, and on a phone it is the only
            way to build anything. A menu trigger carries no
            [data-slot="button"], so the coarse-pointer shield in
            globals.css skips it; this reproduces the shield locally rather
            than inflating the dashed circle, which is a deliberate size in
            the connector chain. */}
        <DropdownMenuTrigger
          className="border-border bg-background text-muted-foreground hover:border-primary hover:bg-primary/10 hover:text-primary data-[popup-open]:border-primary data-[popup-open]:bg-primary/20 data-[popup-open]:text-primary relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed transition-colors duration-(--dur-1) pointer-coarse:before:absolute pointer-coarse:before:-inset-1.5 pointer-coarse:before:content-['']"
          aria-label={t('addStep')}
        >
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-56 overflow-y-auto"
        >
          {ADDABLE_STEPS.map((tp) => {
            const Icon = STEP_META[tp].icon;
            return (
              <DropdownMenuItem key={tp} onClick={() => onPick(tp)}>
                <Icon className="h-4 w-4" />
                {t(`steps.${STEP_META[tp].label}`)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="bg-border h-4 w-[2px]" aria-hidden />
    </div>
  );
}

// ------------------------------------------------------------
// Per-step config editor
// ------------------------------------------------------------

function StepEditor({
  step,
  onChange,
}: {
  step: BuilderStep;
  onChange: (s: BuilderStep) => void;
}) {
  const t = useTranslations('Automations.builder');
  // The loss reasons are worded once, in the outcome dialog's catalogue.
  const tOutcome = useTranslations('Pipelines.outcome');
  const resources = useResources();
  const cfg = step.step_config;
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, step_config: { ...cfg, ...patch } });

  switch (step.step_type) {
    case 'send_message':
      return (
        <FieldBlock label={t('config.messageText')}>
          <Textarea
            value={(cfg.text as string) ?? ''}
            onChange={(e) => set({ text: e.target.value })}
            placeholder={t('config.placeholderMessageText')}
            className="bg-muted text-foreground min-h-24"
          />
        </FieldBlock>
      );
    case 'send_buttons':
    case 'send_list':
      // The whole step_config IS the interactive payload; the shared
      // builder edits it in place (and enforces Meta's limits + preview).
      return (
        <InteractiveBuilder
          value={asInteractive(cfg)}
          onChange={(payload) =>
            onChange({ ...step, step_config: toStepConfig(payload) })
          }
        />
      );
    case 'send_template':
      return (
        <SendTemplateFields
          templateName={(cfg.template_name as string) ?? ''}
          language={(cfg.language as string) ?? ''}
          onChange={(patch) => set(patch)}
          t={t}
        />
      );
    case 'add_tag':
    case 'remove_tag':
      return (
        <FieldBlock label={t('config.tagLabel')}>
          <TagSelect
            value={(cfg.tag_id as string) ?? ''}
            onChange={(v) => set({ tag_id: v })}
            t={t}
          />
        </FieldBlock>
      );
    case 'assign_conversation':
      return (
        <>
          <FieldBlock label={t('config.modeLabel')}>
            <OptionSelect
              value={(cfg.mode as string) ?? 'round_robin'}
              onValueChange={(mode) => set({ mode })}
              className="bg-muted"
            >
              <option value="round_robin">
                {t('config.modes.round_robin')}
              </option>
              <option value="specific">{t('config.modes.specific')}</option>
            </OptionSelect>
          </FieldBlock>
          {cfg.mode === 'specific' && (
            <FieldBlock label={t('config.agentLabel')}>
              <AgentSelect
                value={(cfg.agent_id as string) ?? ''}
                onChange={(v) => set({ agent_id: v })}
                t={t}
              />
            </FieldBlock>
          )}
        </>
      );
    case 'update_contact_field':
      return (
        <>
          <FieldBlock label={t('config.fieldLabel')}>
            <ContactFieldSelect
              value={(cfg.field as string) ?? 'name'}
              onChange={(v) => set({ field: v })}
              t={t}
            />
          </FieldBlock>
          <FieldBlock label={t('config.valueLabel')}>
            <Input
              value={(cfg.value as string) ?? ''}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={t.raw('config.placeholderValue')}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      );
    case 'create_deal':
      return (
        <>
          <DealPipelineFields
            pipelineId={(cfg.pipeline_id as string) ?? ''}
            stageId={(cfg.stage_id as string) ?? ''}
            onChange={(patch) => set(patch)}
            t={t}
          />
          <FieldBlock label={t('config.titleLabel')}>
            <Input
              value={(cfg.title as string) ?? ''}
              onChange={(e) => set({ title: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t('config.valueLabel')}>
            <Input
              type="number"
              value={(cfg.value as number) ?? 0}
              onChange={(e) => set({ value: Number(e.target.value) })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      );
    case 'wait': {
      const untilDate = cfg.mode === 'until_contact_date';
      return (
        <>
          <FieldBlock label={t('config.waitModeLabel')}>
            <OptionSelect
              value={untilDate ? 'until_contact_date' : 'duration'}
              onValueChange={(mode) =>
                set(
                  mode === 'until_contact_date'
                    ? {
                        mode,
                        field:
                          (cfg.field as string) ?? 'next_purchase_expected_at',
                        at: (cfg.at as string) ?? '09:00',
                      }
                    : { mode: 'duration' }
                )
              }
              className="bg-muted"
            >
              <option value="duration">{t('config.waitModes.duration')}</option>
              <option value="until_contact_date">
                {t('config.waitModes.until_contact_date')}
              </option>
            </OptionSelect>
          </FieldBlock>
          {untilDate ? (
            <>
              <FieldBlock label={t('config.dateFieldLabel')}>
                <OptionSelect
                  value={(cfg.field as string) ?? 'next_purchase_expected_at'}
                  onValueChange={(field) => set({ field })}
                  className="bg-muted"
                >
                  <option value="next_purchase_expected_at">
                    {t('config.dateFields.next_purchase_expected_at')}
                  </option>
                  <option value="birthday">
                    {t('config.dateFields.birthday')}
                  </option>
                  <option value="last_purchase_at">
                    {t('config.dateFields.last_purchase_at')}
                  </option>
                </OptionSelect>
              </FieldBlock>
              <FieldBlock label={t('config.atLabel')}>
                <Input
                  value={(cfg.at as string) ?? '09:00'}
                  onChange={(e) => set({ at: e.target.value })}
                  placeholder="09:00"
                  className="bg-muted text-foreground"
                />
              </FieldBlock>
              <p className="text-muted-foreground text-2xs leading-relaxed">
                {t('config.untilDateHint')}
              </p>
            </>
          ) : (
            // Amount + unit want one line, but a hard `grid-cols-2` gave
            // them one everywhere — including a step nested two branches
            // deep on a 360px phone, where each half is under 120px and
            // the select clipped its own options. A container query asks
            // the card, not the viewport: 18rem of editor is enough for
            // the pair, less than that stacks.
            <div className="@container">
              <div className="grid grid-cols-1 gap-2 @2xs:grid-cols-2">
                <FieldBlock label={t('config.amountLabel')}>
                  <Input
                    type="number"
                    min={1}
                    value={(cfg.amount as number) ?? 1}
                    onChange={(e) =>
                      set({ amount: Math.max(1, Number(e.target.value)) })
                    }
                    className="bg-muted text-foreground"
                  />
                </FieldBlock>
                <FieldBlock label={t('config.unitLabel')}>
                  <OptionSelect
                    value={(cfg.unit as string) ?? 'hours'}
                    onValueChange={(unit) => set({ unit })}
                    className="bg-muted"
                  >
                    <option value="minutes">{t('config.units.minutes')}</option>
                    <option value="hours">{t('config.units.hours')}</option>
                    <option value="days">{t('config.units.days')}</option>
                  </OptionSelect>
                </FieldBlock>
              </div>
            </div>
          )}
        </>
      );
    }
    case 'condition': {
      const subject = (cfg.subject as string) ?? 'tag_presence';
      const dealSubject =
        subject === 'deal_in_stage' ||
        subject === 'deal_is_open' ||
        subject === 'customer_replied_since';
      return (
        <>
          <FieldBlock label={t('config.subjectLabel')}>
            <OptionSelect
              value={subject}
              onValueChange={(next) => set({ subject: next, operand: '' })}
              className="bg-muted"
            >
              <option value="tag_presence">
                {t('config.subjects.tag_presence')}
              </option>
              <option value="contact_field">
                {t('config.subjects.contact_field')}
              </option>
              <option value="message_content">
                {t('config.subjects.message_content')}
              </option>
              <option value="time_of_day">
                {t('config.subjects.time_of_day')}
              </option>
              <option value="deal_in_stage">
                {t('config.subjects.deal_in_stage')}
              </option>
              <option value="deal_is_open">
                {t('config.subjects.deal_is_open')}
              </option>
              <option value="customer_replied_since">
                {t('config.subjects.customer_replied_since')}
              </option>
            </OptionSelect>
          </FieldBlock>
          {subject === 'deal_in_stage' && (
            <FieldBlock label={t('config.stagesLabel')}>
              <StageChecklist
                value={(cfg.stage_ids as string[]) ?? []}
                onChange={(next) => set({ stage_ids: next })}
                t={t}
              />
            </FieldBlock>
          )}
          {subject === 'customer_replied_since' && (
            <FieldBlock label={t('config.sinceLabel')}>
              <OptionSelect
                value={(cfg.operand as string) || 'stage_entry'}
                onValueChange={(operand) => set({ operand })}
                className="bg-muted"
              >
                <option value="stage_entry">
                  {t('config.since.stage_entry')}
                </option>
                <option value="run_start">{t('config.since.run_start')}</option>
              </OptionSelect>
            </FieldBlock>
          )}
          {subject === 'deal_is_open' && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t('config.dealIsOpenHint')}
            </p>
          )}
          {!dealSubject && (
            <FieldBlock label={t('config.operandLabel')}>
              <Input
                placeholder={
                  subject === 'time_of_day'
                    ? t('config.placeholderTime')
                    : subject === 'contact_field'
                      ? t('config.placeholderContact')
                      : subject === 'tag_presence'
                        ? t('config.placeholderTag')
                        : ''
                }
                value={(cfg.operand as string) ?? ''}
                onChange={(e) => set({ operand: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
          {(subject === 'contact_field' || subject === 'message_content') && (
            <FieldBlock label={t('config.valueLabel')}>
              <Input
                value={(cfg.value as string) ?? ''}
                onChange={(e) => set({ value: e.target.value })}
                className="bg-muted text-foreground"
              />
            </FieldBlock>
          )}
        </>
      );
    }
    case 'move_deal_stage': {
      const { stages } = resources;
      const target = stages.find((s) => s.id === cfg.stage_id);
      const lost = target ? isLostStage(target.name) : false;
      return (
        <>
          <FieldBlock label={t('pipelines.stageLabel')}>
            <StageSelect
              value={(cfg.stage_id as string) ?? ''}
              onChange={(v) => set({ stage_id: v })}
              t={t}
            />
          </FieldBlock>
          {lost && (
            <FieldBlock label={t('config.lostReasonLabel')}>
              <OptionSelect
                value={(cfg.lost_reason as string) ?? ''}
                onValueChange={(v) => set({ lost_reason: v })}
                className="bg-muted"
              >
                <option value="">{t('config.lostReasonSelect')}</option>
                {LOSS_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {tOutcome(`reasons.${r}`)}
                  </option>
                ))}
              </OptionSelect>
            </FieldBlock>
          )}
          <p className="text-muted-foreground text-2xs leading-relaxed">
            {t('config.moveDealHint')}
          </p>
        </>
      );
    }
    case 'update_deal':
      return (
        <>
          <FieldBlock label={t('config.dealFieldLabel')}>
            <OptionSelect
              value={(cfg.field as string) ?? 'notes'}
              onValueChange={(field) => set({ field })}
              className="bg-muted"
            >
              <option value="notes">{t('config.dealFields.notes')}</option>
              <option value="title">{t('config.dealFields.title')}</option>
              <option value="value">{t('config.dealFields.value')}</option>
              <option value="expected_close_date">
                {t('config.dealFields.expected_close_date')}
              </option>
            </OptionSelect>
          </FieldBlock>
          <FieldBlock label={t('config.valueLabel')}>
            <Input
              value={(cfg.value as string) ?? ''}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={
                cfg.field === 'expected_close_date'
                  ? 'AAAA-MM-DD'
                  : t.raw('config.placeholderValue')
              }
              className="bg-muted text-foreground"
            />
          </FieldBlock>
        </>
      );
    case 'cancel_automations':
      return (
        <>
          <FieldBlock label={t('config.scopeLabel')}>
            <OptionSelect
              value={(cfg.scope as string) ?? 'deal'}
              onValueChange={(scope) => set({ scope })}
              className="bg-muted"
            >
              <option value="deal">{t('config.scopes.deal')}</option>
              <option value="contact">{t('config.scopes.contact')}</option>
            </OptionSelect>
          </FieldBlock>
          <FieldBlock label={t('config.automationsLabel')}>
            <AutomationChecklist
              value={(cfg.automation_ids as string[]) ?? []}
              onChange={(next) => set({ automation_ids: next })}
              t={t}
            />
          </FieldBlock>
        </>
      );
    case 'end':
      return (
        <>
          <FieldBlock label={t('config.reasonLabel')}>
            <Input
              value={(cfg.reason as string) ?? ''}
              onChange={(e) => set({ reason: e.target.value })}
              placeholder={t('config.placeholderReason')}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t('config.endHint')}
          </p>
        </>
      );
    case 'send_webhook':
      return (
        <>
          <FieldBlock label={t('config.urlLabel')}>
            <Input
              value={(cfg.url as string) ?? ''}
              onChange={(e) => set({ url: e.target.value })}
              className="bg-muted text-foreground"
            />
          </FieldBlock>
          <FieldBlock label={t('config.bodyTemplateLabel')}>
            <Textarea
              value={(cfg.body_template as string) ?? ''}
              onChange={(e) => set({ body_template: e.target.value })}
              className="bg-muted text-foreground min-h-20 font-mono text-xs"
            />
          </FieldBlock>
        </>
      );
    case 'close_conversation':
      return (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t('config.closeConversationHint')}
        </p>
      );
    default:
      return null;
  }
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <label className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The one grey line under a step's title — what it will actually do,
 * or what is still missing before it can. The placeholders are the
 * point of it ("sem mensagem ainda"), so they are translated: a
 * Portuguese automation whose unfilled steps read "no text yet" tells
 * the user the app is half-built, which is exactly the impression to
 * avoid on the screen where they are building something.
 */
function previewFor(
  step: BuilderStep,
  t: ReturnType<typeof useTranslations>,
  resources?: AutomationResources
): string {
  const stageName = (id: unknown) =>
    resources?.stages.find((s) => s.id === id)?.name ?? (id ? String(id) : '');
  switch (step.step_type) {
    case 'send_message':
      return (step.step_config.text as string) || t('preview.noText');
    case 'send_buttons':
    case 'send_list':
      return (
        interactivePayloadPreviewText(asInteractive(step.step_config)) ||
        t('preview.noBody')
      );
    case 'send_template':
      return (
        (step.step_config.template_name as string) || t('preview.pickTemplate')
      );
    case 'wait':
      if (step.step_config.mode === 'until_contact_date') {
        return t('preview.untilDate', {
          field: String(step.step_config.field ?? 'next_purchase_expected_at'),
        });
      }
      return `${step.step_config.amount ?? '?'} ${step.step_config.unit ?? ''}`;
    case 'condition':
      return t('preview.when', {
        subject: (step.step_config.subject as string) ?? '?',
      });
    case 'send_webhook':
      return (step.step_config.url as string) || t('preview.noUrl');
    case 'move_deal_stage':
      return stageName(step.step_config.stage_id) || t('preview.noStage');
    case 'update_deal':
      return `${String(step.step_config.field ?? '')}: ${String(step.step_config.value ?? '')}`;
    case 'cancel_automations':
      return t('preview.cancelScope', {
        scope: String(step.step_config.scope ?? 'deal'),
      });
    case 'end':
      return (step.step_config.reason as string) || t('preview.ended');
    default:
      return '';
  }
}

// ------------------------------------------------------------
// Serialize builder tree → API payload (flattened shape)
// ------------------------------------------------------------

interface ApiStep {
  step_type: string;
  step_config: Record<string, unknown>;
  branches?: { yes?: ApiStep[]; no?: ApiStep[] };
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((s) => ({
    step_type: s.step_type,
    step_config: s.step_config,
    branches: s.branches
      ? { yes: toApiSteps(s.branches.yes), no: toApiSteps(s.branches.no) }
      : undefined,
  }));
}

/**
 * Convert server-returned step tree (from loadStepsTree) into the
 * builder-local shape with client ids.
 */
export interface ServerStepNode {
  id: string;
  step_type: string;
  step_config: Record<string, unknown>;
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] };
}

export function fromServerSteps(nodes: ServerStepNode[]): BuilderStep[] {
  return nodes.map((n) => ({
    cid: cid(),
    step_type: n.step_type as AutomationStepType,
    step_config: n.step_config ?? {},
    branches:
      n.step_type === 'condition'
        ? {
            yes: fromServerSteps(n.branches?.yes ?? []),
            no: fromServerSteps(n.branches?.no ?? []),
          }
        : undefined,
  }));
}
