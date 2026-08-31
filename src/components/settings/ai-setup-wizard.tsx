'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  BadgeCheck,
  BookOpen,
  Bot,
  KeyRound,
  Loader2,
  MessageSquareDashed,
  ShieldAlert,
  Wrench,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import { AI_TOOLS } from '@/lib/ai/tools';
import type { AiProvider } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import type { AccountMember } from '@/types';
import { AiKnowledgeCard } from '@/components/settings/ai-knowledge';
import { StepFlow, type Step } from '@/components/settings/step-flow';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Skeleton } from '@/components/dashboard/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { sectionHref } from '@/components/settings/settings-sections';

/**
 * Setting up the assistant, as six questions in an order.
 *
 * The classic form is still there and still reachable — see the escape
 * hatch at the bottom of `AiAgentPanel`. What it could never do is say
 * which field to start with, because a page of eleven inputs has no
 * order in it. These are the six questions the eleven fields are
 * answering:
 *
 *   1. Which provider, and on whose key
 *   2. Who is this assistant
 *   3. What does it know
 *   4. What may it look up
 *   5. When must it stop and fetch a person
 *   6. Where does it run
 *
 * Four of them only make sense once the one before is answered — there
 * is no point choosing tools before the model knows what business it is
 * in — and that is exactly what the wall of fields did not say.
 *
 * ONE STEP SAVES AT A TIME. The API treats an absent field as unchanged
 * (see the note in `/api/ai/config`), so the guardrails somebody wrote
 * on step five survive a later edit to step two. That is what makes it
 * safe to leave without a global Save button.
 */

type Tone = 'formal' | 'neutral' | 'casual';

interface Draft {
  provider: AiProvider;
  model: string;
  apiKey: string;
  keyEdited: boolean;
  hasStoredKey: boolean;
  embeddingsKey: string;
  embeddingsKeyEdited: boolean;
  hasStoredEmbeddingsKey: boolean;

  personaName: string;
  businessDescription: string;
  tone: Tone | '';
  systemPrompt: string;

  retrievalTopK: number;
  enabledTools: string[];

  guardrails: string;
  escalationRules: string;
  autoReplyEnabled: boolean;
  maxPerConversation: number;
  handoffAgentId: string;

  isActive: boolean;
  assistEnabled: boolean;
  mediaUnderstanding: boolean;
  setupCompletedAt: string | null;
}

const EMPTY: Draft = {
  provider: 'openai',
  model: AI_PROVIDER_DEFAULT_MODEL.openai,
  apiKey: '',
  keyEdited: false,
  hasStoredKey: false,
  embeddingsKey: '',
  embeddingsKeyEdited: false,
  hasStoredEmbeddingsKey: false,
  personaName: '',
  businessDescription: '',
  tone: '',
  systemPrompt: '',
  retrievalTopK: 4,
  enabledTools: [],
  guardrails: '',
  escalationRules: '',
  autoReplyEnabled: false,
  maxPerConversation: 3,
  handoffAgentId: '',
  isActive: false,
  assistEnabled: true,
  mediaUnderstanding: true,
  setupCompletedAt: null,
};

const HANDOFF_QUEUE = '__queue__';
const MASKED = '••••••••••••••••';

export function AiSetupWizard({ onOpenAdvanced }: { onOpenAdvanced: () => void }) {
  const t = useTranslations('Settings.aiWizard');
  // `Settings.agentLookups`, not `aiTools`. What the agent can call is a
  // set of LOOKUPS — get_contact, search_products — and the step above
  // already calls them that ("O que ele pode consultar"). The word
  // "ferramentas" belongs to the settings section a person opens to turn
  // features on, and one word cannot mean both.
  const tTools = useTranslations('Settings.agentLookups');
  const { accountId } = useAuth();
  const canEdit = useCan('edit-settings');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [members, setMembers] = useState<AccountMember[]>([]);

  const patch = useCallback(
    (next: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...next } : d)),
    []
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.configured) {
          setDraft(EMPTY);
          // Nothing configured: open on the only step that can be
          // answered first.
          setOpen('key');
          return;
        }
        setDraft({
          ...EMPTY,
          provider: data.provider ?? 'openai',
          model: data.model ?? AI_PROVIDER_DEFAULT_MODEL.openai,
          hasStoredKey: Boolean(data.has_key),
          apiKey: data.has_key ? MASKED : '',
          hasStoredEmbeddingsKey: Boolean(data.has_embeddings_key),
          embeddingsKey: data.has_embeddings_key ? MASKED : '',
          personaName: data.persona_name ?? '',
          businessDescription: data.business_description ?? '',
          tone: (data.tone as Tone) ?? '',
          systemPrompt: data.system_prompt ?? '',
          retrievalTopK:
            typeof data.retrieval_top_k === 'number' ? data.retrieval_top_k : 4,
          enabledTools: Array.isArray(data.enabled_tools)
            ? data.enabled_tools
            : [],
          guardrails: data.guardrails ?? '',
          escalationRules: data.escalation_rules ?? '',
          autoReplyEnabled: data.auto_reply_enabled === true,
          maxPerConversation: data.auto_reply_max_per_conversation ?? 3,
          handoffAgentId: data.handoff_agent_id ?? '',
          isActive: data.is_active === true,
          assistEnabled: data.assist_enabled !== false,
          mediaUnderstanding: data.media_understanding_enabled !== false,
          setupCompletedAt: data.setup_completed_at ?? null,
        });
        // Returning to a configured account: everything collapsed, so
        // the page opens as a summary of what is set rather than as a
        // form demanding attention.
        setOpen(null);
      } catch {
        if (!cancelled) {
          setDraft(EMPTY);
          setOpen('key');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void fetchAccountMembers().then(setMembers);
  }, []);

  /**
   * Save exactly the fields one step owns.
   *
   * Not the whole draft. The route reads an absent key as "leave it
   * alone", so a narrow body is what stops step two's save from
   * overwriting step five with whatever this browser last read — which
   * matters on the screen two admins are most likely to open at once.
   */
  const save = useCallback(
    async (stepId: string, body: Record<string, unknown>) => {
      if (!draft) return false;
      setSaving(stepId);
      try {
        const res = await fetch('/api/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // The route requires these on every write — they are what it
            // validates the credentials against.
            provider: draft.provider,
            model: draft.model.trim(),
            ...body,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? t('saveFailed'));
          return false;
        }
        toast.success(t('saved'));
        return true;
      } catch {
        toast.error(t('saveFailed'));
        return false;
      } finally {
        setSaving(null);
      }
    },
    [draft, t]
  );

  const test = useCallback(async () => {
    if (!draft) return;
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: draft.provider,
          model: draft.model.trim(),
          api_key: draft.keyEdited ? draft.apiKey.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('testFailed'));
        return;
      }
      toast.success(t('testOk'));
    } catch {
      toast.error(t('testFailed'));
    } finally {
      setTesting(false);
    }
  }, [draft, t]);

  const steps: Step[] = useMemo(() => {
    if (!draft) return [];
    const busy = (id: string) => saving === id;

    return [
      {
        id: 'key',
        icon: <KeyRound />,
        title: t('stepKeyTitle'),
        summary: t('stepKeySummary'),
        status: draft.hasStoredKey ? draft.model : t('notSet'),
        done: draft.hasStoredKey,
        content: (
          <div className="space-y-3">
            <div className="grid gap-3 @md:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="wiz-provider">{t('provider')}</FieldLabel>
                <Select
                  value={draft.provider}
                  onValueChange={(v) => {
                    if (!v) return;
                    const provider = v as AiProvider;
                    // Swap the model along with the provider unless
                    // somebody typed their own — a default model from the
                    // other vendor is a 404 with a confusing message.
                    const isDefault =
                      draft.model === AI_PROVIDER_DEFAULT_MODEL.openai ||
                      draft.model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
                      !draft.model.trim();
                    patch({
                      provider,
                      model: isDefault
                        ? AI_PROVIDER_DEFAULT_MODEL[provider]
                        : draft.model,
                    });
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="wiz-provider">
                    <SelectValue>
                      {draft.provider === 'openai' ? 'OpenAI' : 'Anthropic'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="wiz-model">{t('model')}</FieldLabel>
                <Input
                  id="wiz-model"
                  value={draft.model}
                  onChange={(e) => patch({ model: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="wiz-key">{t('apiKey')}</FieldLabel>
              <p className="text-muted-foreground text-xs">{t('apiKeyDesc')}</p>
              <PasswordInput
                id="wiz-key"
                value={draft.apiKey}
                onChange={(e) =>
                  patch({ apiKey: e.target.value, keyEdited: true })
                }
                placeholder={draft.hasStoredKey ? MASKED : 'sk-…'}
                disabled={!canEdit}
                showLabel={t('showKey')}
                hideLabel={t('hideKey')}
              />
            </div>

            {canEdit && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={test} disabled={testing}>
                  {testing ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('test')}
                </Button>
                <Button
                  disabled={busy('key')}
                  onClick={async () => {
                    const ok = await save('key', {
                      api_key: draft.keyEdited ? draft.apiKey.trim() : undefined,
                    });
                    if (ok) {
                      patch({
                        keyEdited: false,
                        hasStoredKey: true,
                        apiKey: MASKED,
                      });
                      setOpen('persona');
                    }
                  }}
                >
                  {busy('key') ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t('saveAndNext')}
                </Button>
              </div>
            )}
          </div>
        ),
      },

      {
        id: 'persona',
        icon: <Bot />,
        title: t('stepPersonaTitle'),
        summary: t('stepPersonaSummary'),
        status: draft.businessDescription ? t('filled') : t('empty'),
        done: !!draft.businessDescription.trim(),
        content: (
          <div className="space-y-3">
            <div className="grid gap-3 @md:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="wiz-persona">{t('personaName')}</FieldLabel>
                <Input
                  id="wiz-persona"
                  value={draft.personaName}
                  maxLength={40}
                  placeholder={t('personaPlaceholder')}
                  onChange={(e) => patch({ personaName: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="wiz-tone">{t('tone')}</FieldLabel>
                <Select
                  value={draft.tone || 'neutral'}
                  onValueChange={(v) => v && patch({ tone: v as Tone })}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="wiz-tone">
                    <SelectValue>
                      {t(`tone_${draft.tone || 'neutral'}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="formal">{t('tone_formal')}</SelectItem>
                    <SelectItem value="neutral">{t('tone_neutral')}</SelectItem>
                    <SelectItem value="casual">{t('tone_casual')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="wiz-business">{t('business')}</FieldLabel>
              {/* The single highest-value field on the page: most wrong
                  answers are a model that does not know what business it
                  is in. */}
              <p className="text-muted-foreground text-xs">{t('businessDesc')}</p>
              <Textarea
                id="wiz-business"
                rows={4}
                value={draft.businessDescription}
                placeholder={t('businessPlaceholder')}
                onChange={(e) => patch({ businessDescription: e.target.value })}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="wiz-prompt">{t('extraPrompt')}</FieldLabel>
              <p className="text-muted-foreground text-xs">
                {t('extraPromptDesc')}
              </p>
              <Textarea
                id="wiz-prompt"
                rows={3}
                value={draft.systemPrompt}
                onChange={(e) => patch({ systemPrompt: e.target.value })}
                disabled={!canEdit}
              />
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <Button
                  disabled={busy('persona')}
                  onClick={async () => {
                    const ok = await save('persona', {
                      persona_name: draft.personaName,
                      business_description: draft.businessDescription,
                      tone: draft.tone || 'neutral',
                      system_prompt: draft.systemPrompt || null,
                    });
                    if (ok) setOpen('knowledge');
                  }}
                >
                  {busy('persona') ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t('saveAndNext')}
                </Button>
              </div>
            )}
          </div>
        ),
      },

      {
        id: 'knowledge',
        icon: <BookOpen />,
        title: t('stepKnowledgeTitle'),
        summary: t('stepKnowledgeSummary'),
        status: t('topK', { count: draft.retrievalTopK }),
        done: draft.hasStoredEmbeddingsKey || draft.retrievalTopK > 0,
        content: (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="wiz-embed">{t('embeddingsKey')}</FieldLabel>
              <p className="text-muted-foreground text-xs">
                {t('embeddingsKeyDesc')}
              </p>
              <PasswordInput
                id="wiz-embed"
                value={draft.embeddingsKey}
                onChange={(e) =>
                  patch({
                    embeddingsKey: e.target.value,
                    embeddingsKeyEdited: true,
                  })
                }
                placeholder={draft.hasStoredEmbeddingsKey ? MASKED : 'sk-…'}
                disabled={!canEdit}
                showLabel={t('showKey')}
                hideLabel={t('hideKey')}
              />
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="wiz-topk">{t('retrievalTopK')}</FieldLabel>
              <p className="text-muted-foreground text-xs">
                {t('retrievalTopKDesc')}
              </p>
              <Input
                id="wiz-topk"
                type="number"
                min={0}
                max={20}
                value={draft.retrievalTopK}
                onChange={(e) =>
                  patch({
                    retrievalTopK: Math.min(
                      20,
                      Math.max(0, Number(e.target.value) || 0)
                    ),
                  })
                }
                disabled={!canEdit}
                className="w-24"
              />
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <Button
                  disabled={busy('knowledge')}
                  onClick={async () => {
                    const ok = await save('knowledge', {
                      retrieval_top_k: draft.retrievalTopK,
                      embeddings_api_key: draft.embeddingsKeyEdited
                        ? draft.embeddingsKey.trim() || null
                        : undefined,
                    });
                    if (ok) {
                      patch({
                        embeddingsKeyEdited: false,
                        hasStoredEmbeddingsKey: !!draft.embeddingsKey.trim(),
                      });
                      setOpen('tools');
                    }
                  }}
                >
                  {busy('knowledge') ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t('saveAndNext')}
                </Button>
              </div>
            )}

            {/* The documents themselves, in the step that is about them.
                They used to live at the bottom of the page, below the
                switches, where the connection to "what does it know" was
                left for the reader to make. */}
            <AiKnowledgeCard
              accountId={accountId}
              canEdit={canEdit}
              hasEmbeddingsKey={draft.hasStoredEmbeddingsKey}
            />
          </div>
        ),
      },

      {
        id: 'tools',
        icon: <Wrench />,
        title: t('stepToolsTitle'),
        summary: t('stepToolsSummary'),
        status: t('toolCount', { count: draft.enabledTools.length }),
        done: draft.enabledTools.length > 0,
        content: (
          <div className="space-y-3">
            <p className="border-border bg-muted/40 text-muted-foreground rounded-md border p-3 text-xs">
              {t('toolsNote')}
            </p>
            <ul className="divide-border border-border divide-y rounded-md border">
              {AI_TOOLS.map((tool) => {
                const on = draft.enabledTools.includes(tool.name);
                return (
                  <li
                    key={tool.name}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-sm">
                        {tTools(`${tool.labelKey}`)}
                      </p>
                      <p className="text-muted-foreground text-2xs">
                        {tTools(`${tool.labelKey}Desc`)}
                      </p>
                    </div>
                    <Switch
                      checked={on}
                      disabled={!canEdit}
                      onCheckedChange={(next) =>
                        patch({
                          enabledTools: next
                            ? [...draft.enabledTools, tool.name]
                            : draft.enabledTools.filter((n) => n !== tool.name),
                        })
                      }
                    />
                  </li>
                );
              })}
            </ul>
            {canEdit && (
              <div className="flex justify-end">
                <Button
                  disabled={busy('tools')}
                  onClick={async () => {
                    const ok = await save('tools', {
                      enabled_tools: draft.enabledTools,
                    });
                    if (ok) setOpen('limits');
                  }}
                >
                  {busy('tools') ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t('saveAndNext')}
                </Button>
              </div>
            )}
          </div>
        ),
      },

      {
        id: 'limits',
        icon: <ShieldAlert />,
        title: t('stepLimitsTitle'),
        summary: t('stepLimitsSummary'),
        status: draft.guardrails ? t('filled') : t('empty'),
        done: !!draft.guardrails.trim() || !!draft.escalationRules.trim(),
        content: (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="wiz-guard">{t('guardrails')}</FieldLabel>
              <p className="text-muted-foreground text-xs">
                {t('guardrailsDesc')}
              </p>
              <Textarea
                id="wiz-guard"
                rows={3}
                value={draft.guardrails}
                placeholder={t('guardrailsPlaceholder')}
                onChange={(e) => patch({ guardrails: e.target.value })}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-1.5">
              <FieldLabel htmlFor="wiz-escal">{t('escalation')}</FieldLabel>
              <p className="text-muted-foreground text-xs">
                {t('escalationDesc')}
              </p>
              <Textarea
                id="wiz-escal"
                rows={3}
                value={draft.escalationRules}
                placeholder={t('escalationPlaceholder')}
                onChange={(e) => patch({ escalationRules: e.target.value })}
                disabled={!canEdit}
              />
            </div>

            <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">
                  {t('autoReply')}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={draft.autoReplyEnabled}
                onCheckedChange={(v) => patch({ autoReplyEnabled: v })}
                disabled={!canEdit}
              />
            </div>

            <div className="grid gap-3 @md:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="wiz-max">{t('maxPerConversation')}</FieldLabel>
                <Input
                  id="wiz-max"
                  type="number"
                  min={1}
                  max={20}
                  value={draft.maxPerConversation}
                  onChange={(e) =>
                    patch({
                      maxPerConversation: Math.min(
                        20,
                        Math.max(1, Number(e.target.value) || 1)
                      ),
                    })
                  }
                  disabled={!canEdit || !draft.autoReplyEnabled}
                  className="w-24"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="wiz-handoff">{t('handoff')}</FieldLabel>
                <Select
                  value={draft.handoffAgentId || HANDOFF_QUEUE}
                  onValueChange={(v) =>
                    patch({
                      handoffAgentId: !v || v === HANDOFF_QUEUE ? '' : v,
                    })
                  }
                  disabled={!canEdit || !draft.autoReplyEnabled}
                >
                  <SelectTrigger id="wiz-handoff">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HANDOFF_QUEUE}>
                      {t('handoffQueue')}
                    </SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {memberLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <Button
                  disabled={busy('limits')}
                  onClick={async () => {
                    const ok = await save('limits', {
                      guardrails: draft.guardrails,
                      escalation_rules: draft.escalationRules,
                      auto_reply_enabled: draft.autoReplyEnabled,
                      auto_reply_max_per_conversation: draft.maxPerConversation,
                      handoff_agent_id: draft.handoffAgentId || null,
                    });
                    if (ok) setOpen('live');
                  }}
                >
                  {busy('limits') ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t('saveAndNext')}
                </Button>
              </div>
            )}
          </div>
        ),
      },

      {
        id: 'live',
        icon: <MessageSquareDashed />,
        title: t('stepLiveTitle'),
        summary: t('stepLiveSummary'),
        status: draft.isActive ? t('on') : t('off'),
        done: draft.isActive,
        content: (
          <div className="space-y-3">
            <SwitchRow
              title={t('isActive')}
              description={t('isActiveDesc')}
              checked={draft.isActive}
              disabled={!canEdit}
              onChange={(v) => patch({ isActive: v })}
            />
            {/* A resposta sugerida e a leitura de mídia MORAVAM AQUI,
                com `disabled={!draft.isActive}` — desligar o robô que
                fala com o cliente desligava a transcrição de áudio do
                atendente. Duas decisões sem relação num interruptor só.
                Foram para Configurações › Ferramentas de IA (057). */}
            <p className="text-muted-foreground text-xs">
              {t.rich('toolsMoved', {
                link: (chunks) => (
                  <a
                    href={sectionHref('ai-tools')}
                    className="text-primary underline underline-offset-2"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>

            {canEdit && (
              <div className="flex justify-end">
                <Button
                  disabled={busy('live')}
                  onClick={async () => {
                    const ok = await save('live', {
                      is_active: draft.isActive,
                      // Deliberately NOT sent any more. The route only
                      // writes keys that are present, so leaving them out
                      // is what stops a save here from clobbering what
                      // Ferramentas de IA set. See 057.
                      setup_completed: true,
                    });
                    if (ok) {
                      patch({ setupCompletedAt: new Date().toISOString() });
                      setOpen(null);
                    }
                  }}
                >
                  {busy('live') ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t('finish')}
                </Button>
              </div>
            )}
          </div>
        ),
      },
    ];
  }, [draft, saving, testing, canEdit, members, accountId, patch, save, test, t, tTools]);

  if (!draft) return <Skeleton className="h-64 w-full" />;

  const done = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-4">
      {/* Progress as a sentence, not a bar. "4 de 6" is the same
          information and it does not need a legend. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
            done === steps.length
              ? 'bg-ok-soft text-ok-ink'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <BadgeCheck className="size-3.5" />
          {t('progress', { done, total: steps.length })}
        </span>
        <button
          type="button"
          onClick={onOpenAdvanced}
          className="text-muted-foreground hover:text-foreground ml-auto text-xs font-medium underline underline-offset-2"
        >
          {t('openAdvanced')}
        </button>
      </div>

      <StepFlow steps={steps} openId={open} onOpen={setOpen} />
    </div>
  );
}

export function SwitchRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  );
}
