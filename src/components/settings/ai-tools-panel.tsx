'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  AudioLines,
  FileText,
  ImageIcon,
  Loader2,
  Sparkles,
} from 'lucide-react';

import { useCan } from '@/hooks/use-can';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { SwitchRow } from '@/components/settings/ai-setup-wizard';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';
import { Switch } from '@/components/ui/switch';
import { sectionHref } from '@/components/settings/settings-sections';

/**
 * The AI a PERSON operates, on its own screen.
 *
 * Called "Ferramentas de IA" for the reason a name is chosen: it is the
 * place somebody opens to switch features on. What the AGENT can call
 * mid-sentence — get_contact, search_products — are LOOKUPS, and its own
 * step already says so ("O que ele pode consultar"). Two different things
 * do not get one word.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS NOT A TAB INSIDE THE AGENT
 * ------------------------------------------------------------------
 *
 * These four things — suggest a reply, transcribe an audio, describe a
 * photo, read a PDF — never talk to a customer. They read what arrived
 * and hand words to the attendant, who decides what to do. The agent is
 * the opposite: it answers on its own, in the company's name, while
 * nobody is watching.
 *
 * That is a difference in KIND, not in configuration depth, and until
 * migration 057 the product denied it: everything hung off `is_active`,
 * so an account that did not want a robot replying to customers — the
 * common, sensible position — also got no audio transcribed. The switch
 * meant to say "no bots" was saying "no help either".
 *
 * ------------------------------------------------------------------
 * THE KEY IS SHARED, THE SWITCHES ARE NOT
 * ------------------------------------------------------------------
 *
 * One account, one provider, one BYO key. Asking for it twice would be
 * two places to rotate it and two places to get it wrong. What is
 * separate is what each half is ALLOWED to do — and the model, because
 * the two loads are opposite: the agent answers everybody all day and
 * wants something cheap; this runs a few times an hour when somebody
 * asks, and can afford something better.
 *
 * ------------------------------------------------------------------
 * ONE SWITCH PER FUNCTION
 * ------------------------------------------------------------------
 *
 * Not one for "media". A minute of speech costs a fraction of one
 * photo, and a twenty-page PDF costs more than both — so document
 * reading arrives OFF and the other two keep whatever the account had.
 * Somebody who wants transcription and not vision can have exactly that.
 */

interface Draft {
  active: boolean;
  suggest: boolean;
  audio: boolean;
  image: boolean;
  document: boolean;
  model: string;
}

const EMPTY: Draft = {
  active: false,
  suggest: false,
  audio: false,
  image: false,
  document: false,
  model: '',
};

export function AiToolsPanel() {
  const t = useTranslations('Settings.aiTools');
  const canEdit = useCan('edit-settings');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [agentModel, setAgentModel] = useState('');
  const [provider, setProvider] = useState('');
  const [hasEmbeddingsKey, setHasEmbeddingsKey] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const apply = useCallback((data: Record<string, unknown> | null) => {
    if (!data) {
      setDraft(EMPTY);
      return;
    }
    setHasKey(data.has_key === true);
    setAgentModel(typeof data.model === 'string' ? data.model : '');
    setProvider(typeof data.provider === 'string' ? data.provider : '');
    setHasEmbeddingsKey(data.has_embeddings_key === true);
    setDraft({
      // `?? is_active` is the pre-057 answer and it is the honest one:
      // on a database without the migration these tools really do ride
      // on the agent's switch, so the screen must show that rather than
      // a comfortable false.
      active:
        typeof data.assist_is_active === 'boolean'
          ? data.assist_is_active
          : data.is_active === true,
      suggest: data.assist_enabled !== false,
      audio:
        typeof data.transcribe_audio_enabled === 'boolean'
          ? data.transcribe_audio_enabled
          : data.media_understanding_enabled !== false,
      image:
        typeof data.describe_image_enabled === 'boolean'
          ? data.describe_image_enabled
          : data.media_understanding_enabled !== false,
      document: data.read_document_enabled === true,
      model: typeof data.assist_model === 'string' ? data.assist_model : '',
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/ai/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        apply(data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));

  async function save() {
    setSaving(true);
    try {
      // ONLY this screen's keys. The route writes what it is given and
      // leaves the rest alone, which is what keeps saving here from
      // resetting the agent's prompt — and saving there from switching
      // transcription off.
      const res = await fetch('/api/ai/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assist_is_active: draft.active,
          assist_enabled: draft.suggest,
          transcribe_audio_enabled: draft.audio,
          describe_image_enabled: draft.image,
          read_document_enabled: draft.document,
          assist_model: draft.model.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Every row below depends on the master switch, so it is stated once
  // here rather than repeated as `disabled` five times.
  const off = !draft.active;

  /**
   * Turned on, and still cannot work.
   *
   * Anthropic has no audio input. On an Anthropic account transcription
   * runs on the OpenAI embeddings key — and if that key is absent the
   * switch says ON, the audio arrives, and nothing happens. Silently:
   * `understandInboundMedia` returns `unsupported`, which is the correct
   * internal answer and a useless thing for a person to never be told.
   *
   * A switch that lies is worse than a switch that is missing, so the
   * row says so where the decision is being made.
   */
  const audioCannotWork =
    draft.audio && provider === 'anthropic' && !hasEmbeddingsKey;

  return (
    <div className="space-y-4">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* The key belongs to the agent's screen. Saying so — with the way
          to get there — beats a second key field that silently writes the
          same column. */}
      {!hasKey && (
        <Panel>
          <PanelBody className="text-muted-foreground text-sm">
            {t.rich('noKey', {
              link: (chunks) => (
                <a
                  href={sectionHref('ai')}
                  className="text-primary underline underline-offset-2"
                >
                  {chunks}
                </a>
              ),
            })}
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelHeader className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <PanelTitle>{t('masterTitle')}</PanelTitle>
            <PanelSub>{t('masterDesc')}</PanelSub>
          </div>
          <Switch
            checked={draft.active}
            onCheckedChange={(v) => patch({ active: v })}
            disabled={!canEdit || !hasKey}
            aria-label={t('masterTitle')}
          />
        </PanelHeader>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>{t('functionsTitle')}</PanelTitle>
          <PanelSub>{t('functionsDesc')}</PanelSub>
        </PanelHeader>
        <PanelBody className="space-y-3">
          <ToolRow
            icon={<Sparkles className="size-3.5" />}
            title={t('suggest')}
            description={t('suggestDesc')}
            checked={draft.suggest}
            disabled={!canEdit || off}
            onChange={(v) => patch({ suggest: v })}
          />
          <ToolRow
            icon={<AudioLines className="size-3.5" />}
            title={t('audio')}
            description={t('audioDesc')}
            checked={draft.audio}
            disabled={!canEdit || off}
            onChange={(v) => patch({ audio: v })}
            warning={
              audioCannotWork
                ? t.rich('audioNeedsOpenAi', {
                    link: (chunks) => (
                      <a
                        href={sectionHref('ai')}
                        className="underline underline-offset-2"
                      >
                        {chunks}
                      </a>
                    ),
                  })
                : null
            }
          />
          <ToolRow
            icon={<ImageIcon className="size-3.5" />}
            title={t('image')}
            description={t('imageDesc')}
            checked={draft.image}
            disabled={!canEdit || off}
            onChange={(v) => patch({ image: v })}
          />
          <ToolRow
            icon={<FileText className="size-3.5" />}
            title={t('document')}
            description={t('documentDesc')}
            checked={draft.document}
            disabled={!canEdit || off}
            onChange={(v) => patch({ document: v })}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>{t('modelTitle')}</PanelTitle>
          <PanelSub>{t('modelDesc')}</PanelSub>
        </PanelHeader>
        <PanelBody className="space-y-2">
          <FieldLabel htmlFor="assist-model">{t('modelLabel')}</FieldLabel>
          <Input
            id="assist-model"
            value={draft.model}
            disabled={!canEdit || off}
            // The agent's model as the placeholder, so an empty field
            // reads as "the same one" instead of as "none".
            placeholder={agentModel || t('modelPlaceholder')}
            onChange={(e) => patch({ model: e.target.value })}
          />
        </PanelBody>
      </Panel>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A `SwitchRow` with the function's own mark in front of it. */
function ToolRow({
  icon,
  warning,
  ...rest
}: {
  icon: React.ReactNode;
  /** Shown under the row when the switch is on but cannot do anything. */
  warning?: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="bg-muted text-muted-foreground mt-3 grid size-7 shrink-0 place-items-center rounded-md">
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <SwitchRow {...rest} />
        {warning ? (
          // Amber, and only here. This is the one thing on the screen a
          // person has to act on — everything else is a preference.
          <p className="bg-human-soft text-human-ink flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{warning}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
