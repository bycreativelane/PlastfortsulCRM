'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  AutomationBuilder,
  fromServerSteps,
  type BuilderInitial,
  type ServerStepNode,
} from '@/components/automations/automation-builder';
import { Button } from '@/components/ui/button';
import { StatePanel } from '@/components/ui/state-panel';
import type { AutomationTriggerType } from '@/types';

export default function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const t = useTranslations('Automations.edit');
  const [initial, setInitial] = useState<BuilderInitial | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/automations/${id}`);
      if (!res.ok) {
        if (!cancelled) setError(t('loadError', { status: res.status }));
        return;
      }
      const body = await res.json();
      if (cancelled) return;
      setInitial({
        id: body.automation.id,
        name: body.automation.name ?? '',
        description: body.automation.description ?? '',
        trigger_type: body.automation.trigger_type as AutomationTriggerType,
        trigger_config: body.automation.trigger_config ?? {},
        is_active: !!body.automation.is_active,
        steps: fromServerSteps((body.steps ?? []) as ServerStepNode[]),
      });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    // StatePanel, not a hand-rolled frame. This one owned a whole route
    // and still said "this broke" in a bare `text-red-400` paragraph — a
    // raw Tailwind red the theme never remaps, and the only way out was a
    // bare <button> that misses the coarse-pointer 44px shield.
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center">
        <StatePanel
          size="md"
          icon={AlertTriangle}
          title={t('loadErrorTitle')}
          description={error}
          actions={
            <Button
              variant="outline"
              onClick={() => router.push('/automations')}
            >
              {t('back')}
            </Button>
          }
        />
      </div>
    );
  }

  if (!initial) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return <AutomationBuilder initial={initial} />;
}
