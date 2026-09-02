'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  AutomationBuilder,
  DEFAULT_RULES,
  type BuilderInitial,
  type BuilderStep,
} from '@/components/automations/automation-builder';
import {
  AUTOMATION_TEMPLATES,
  localizeTemplate,
  resolveTemplateReferences,
  templateNeedsLookup,
  type LocalizedTemplate,
  type TemplateLookup,
  type TemplateSlug,
} from '@/lib/automations/templates';
import { createClient } from '@/lib/supabase/client';
import type {
  AutomationStepType,
  AutomationTriggerType,
  QuickReply,
} from '@/types';

// `useSearchParams` requires a Suspense boundary or the production build
// bails to CSR and errors out. Thin wrapper supplies it; the inner
// component reads the `?template=` query string.
export default function NewAutomationPage() {
  return (
    <Suspense fallback={null}>
      <NewAutomationPageInner />
    </Suspense>
  );
}

function NewAutomationPageInner() {
  const params = useSearchParams();
  const tpl = useTranslations('Automations.templates');
  const template = params.get('template') as TemplateSlug | null;
  const def = template ? AUTOMATION_TEMPLATES[template] : undefined;

  // A template of the official flow names stages, tags and quick replies
  // rather than carrying ids. Those are this account's, so they are looked
  // up before the builder opens; a blank automation or a plain template
  // needs nothing and renders at once.
  const needsLookup = !!def && templateNeedsLookup(def);
  const [lookup, setLookup] = useState<TemplateLookup | null>(null);

  useEffect(() => {
    if (!needsLookup) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const [pipelines, stages, tags] = await Promise.all([
        supabase.from('pipelines').select('id, name'),
        supabase.from('pipeline_stages').select('id, name, pipeline_id'),
        supabase.from('tags').select('id, name'),
      ]);
      let quickReplies: QuickReply[] = [];
      try {
        const res = await fetch('/api/quick-replies', { cache: 'no-store' });
        if (res.ok) {
          const json = (await res.json()) as { quick_replies?: QuickReply[] };
          quickReplies = json.quick_replies ?? [];
        }
      } catch {
        // Endpoint absent: the shortcut stays unresolved and is picked by hand.
      }
      if (cancelled) return;
      setLookup({
        pipelines: (pipelines.data as TemplateLookup['pipelines'] | null) ?? [],
        stages: (stages.data as TemplateLookup['stages'] | null) ?? [],
        tags: (tags.data as TemplateLookup['tags'] | null) ?? [],
        quickReplies,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [needsLookup]);

  const prepared = useMemo<{
    initial: BuilderInitial | null;
    unresolved: string[];
  }>(() => {
    if (def) {
      // The template arrives as shape only; this is where it gets its
      // words — including the message text seeded into each send step,
      // which the user is about to edit and then send to a customer.
      const t = localizeTemplate(def, tpl);
      if (needsLookup) {
        if (!lookup) return { initial: null, unresolved: [] };
        const resolved = resolveTemplateReferences(t, lookup);
        return {
          initial: fromLocalized(
            { ...t, steps: resolved.steps },
            resolved.trigger_config,
            resolved.rules
          ),
          unresolved: resolved.unresolved,
        };
      }
      return {
        initial: fromLocalized(
          t,
          t.trigger_config as Record<string, unknown>,
          DEFAULT_RULES
        ),
        unresolved: [],
      };
    }
    return {
      initial: {
        name: '',
        description: '',
        trigger_type: 'new_message_received' as AutomationTriggerType,
        trigger_config: {},
        is_active: false,
        steps: [],
        ...DEFAULT_RULES,
      },
      unresolved: [],
    };
  }, [def, needsLookup, lookup, tpl]);

  // Said once, after the builder is on screen: the names this account
  // could not answer to. The steps stay empty where they were, and
  // activation refuses until they are picked — this is the heads-up.
  const unresolvedKey = prepared.unresolved.join('|');
  useEffect(() => {
    if (!unresolvedKey) return;
    toast.warning(
      tpl('unresolved', { names: prepared.unresolved.join(', ') }),
      {
        duration: 10000,
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolvedKey]);

  const initial = prepared.initial;

  if (!initial) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return <AutomationBuilder initial={initial} />;
}

function fromLocalized(
  t: LocalizedTemplate,
  triggerConfig: Record<string, unknown>,
  rules: Pick<
    BuilderInitial,
    | 'pipeline_id'
    | 'cancel_on_reply'
    | 'cancel_when_stage_in'
    | 'reentry_policy'
    | 'reentry_days'
  >
): BuilderInitial {
  const steps = expandFromSeeds(
    t.steps.map((seed, idx) => ({
      index: idx,
      step_type: seed.step_type,
      step_config: seed.step_config as Record<string, unknown>,
      branch: seed.branch ?? null,
      parent_index: seed.parent_index ?? null,
    }))
  );
  return {
    name: t.name,
    description: t.description,
    trigger_type: t.trigger_type,
    trigger_config: triggerConfig,
    is_active: false,
    steps,
    ...rules,
  };
}

interface SeedRow {
  index: number;
  step_type: AutomationStepType;
  step_config: Record<string, unknown>;
  branch: 'yes' | 'no' | null;
  parent_index: number | null;
}

function uid(): string {
  return (
    'c_' +
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36))
  );
}

/** Template seeds are flat with parent_index references. Expand into the
 *  builder's nested tree, preserving order within each scope. */
function expandFromSeeds(rows: SeedRow[]): BuilderStep[] {
  const nodes: BuilderStep[] = rows.map((r) => ({
    cid: uid(),
    step_type: r.step_type,
    step_config: r.step_config,
    branches: r.step_type === 'condition' ? { yes: [], no: [] } : undefined,
  }));
  const roots: BuilderStep[] = [];
  rows.forEach((r, i) => {
    if (r.parent_index == null) {
      roots.push(nodes[i]);
      return;
    }
    const parent = nodes[r.parent_index];
    if (!parent.branches) parent.branches = { yes: [], no: [] };
    parent.branches[r.branch ?? 'yes'].push(nodes[i]);
  });
  return roots;
}
