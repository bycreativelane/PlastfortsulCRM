'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, Settings2, Sparkles } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiConfig } from '@/components/settings/ai-config';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { AiSetupWizard } from '@/components/settings/ai-setup-wizard';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab = 'playground' | 'setup' | 'usage';

/**
 * The AI agent, as a Settings section rather than a menu destination.
 *
 * It used to be `/agents`, a top-level row in the Automação group, and
 * three things in the code already disagreed with that: the Setup tab
 * imports `AiConfig` from this very folder, `ai-knowledge.tsx` lives
 * here too, and the page gated on `canEditSettings` — the permission
 * that guards Settings. What the three tabs actually do is test,
 * configure and meter. None of it is work: the agent's output arrives
 * in the inbox, and you come here once to hand it a key and a prompt.
 *
 * The tabs survive the move because they are a real sequence — set it
 * up, try it, then watch what it costs — and flattening them into the
 * rail would put three rows in Settings for one subject.
 */
export function AiAgentPanel() {
  const t = useTranslations('Settings.aiAgent');
  const { accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('playground');
  const [decided, setDecided] = useState(false);
  /**
   * The classic all-fields form, behind a link.
   *
   * The guided steps are the default because they are the version
   * somebody can follow the first time. The form stays because it is the
   * version somebody who already knows what they are doing wants on the
   * sixth visit, and deleting it would have made this an upgrade for one
   * of those two people and a downgrade for the other.
   */
  const [advanced, setAdvanced] = useState(false);

  // Land first-time users on Setup, returning users on the Playground.
  // Until that resolves the tabs stay unmounted rather than rendering
  // the wrong one and swapping — a tab strip that moves under you on
  // arrival is worse than one that arrives a beat late.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setTab(data?.configured ? 'playground' : 'setup');
      } catch {
        if (!cancelled) setTab('setup');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {/* The same head every other section opens with. This one had a
          bare paragraph — which is a small thing and exactly the kind of
          small thing that makes moving between two settings sections
          feel like moving between two products. */}
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {decided && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-4">
          <TabsList>
            <TabsTrigger value="playground">
              <Sparkles className="mr-1.5 size-4" /> {t('tabPlayground')}
            </TabsTrigger>
            <TabsTrigger value="setup">
              <Settings2 className="mr-1.5 size-4" /> {t('tabSetup')}
            </TabsTrigger>
            {canViewUsage && (
              <TabsTrigger value="usage">
                <BarChart3 className="mr-1.5 size-4" /> {t('tabUsage')}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="playground" className="mt-4">
            <AiPlayground onGoToSetup={() => setTab('setup')} />
          </TabsContent>

          <TabsContent value="setup" className="mt-4">
            {advanced ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setAdvanced(false)}
                  className="text-muted-foreground hover:text-foreground text-xs font-medium underline underline-offset-2"
                >
                  {t('backToGuided')}
                </button>
                <AiConfig />
              </div>
            ) : (
              <AiSetupWizard onOpenAdvanced={() => setAdvanced(true)} />
            )}
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="usage" className="mt-4">
              <AiUsageCard />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
