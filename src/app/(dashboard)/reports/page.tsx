'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, GitBranch, Lock, Users, Zap } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { formatCurrency } from '@/lib/currency';
import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries';
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types';
import type { Deal, Pipeline, PipelineStage } from '@/types';

import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { PipelineDonut } from '@/components/dashboard/pipeline-donut';
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { PipelineAnalytics } from '@/components/pipelines/pipeline-analytics';
import { Metric } from '@/components/ui/metric';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { PageHeader } from '@/components/layout/page-header';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { cn } from '@/lib/utils';

type RangeDays = 7 | 30 | 90;

/**
 * Reports — the owner's read of the operation.
 *
 * Split out of the dashboard on purpose. The two answer different questions,
 * and merging them served neither: an agent opening the app needs "what has to
 * happen right now", which is what /dashboard is for, while an owner asking
 * "how did the month go" wants period totals and trends and does not want them
 * competing for the same screen.
 *
 * Restricted to admins and owners. Not because the numbers are secret, but
 * because per-user conversion and value-closed is the kind of measurement that
 * changes how a team behaves when it is on everybody's landing page.
 */
export default function ReportsPage() {
  const t = useTranslations('Reports');
  const { accountRole, defaultCurrency, profileLoading } = useAuth();
  // `accountRole` is null until the profile fetch settles, and the shell's
  // own gate only waits on the SESSION (`loading`), not on this. So the
  // owner of the account used to be told "Acesso restrito" on every load
  // of this page, for as long as the profile took to arrive. A permission
  // system that denies you and then changes its mind is one you stop
  // trusting — the cost is not the frame, it is the credibility.
  const allowed = accountRole ? canEditSettings(accountRole) : false;

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [range, setRange] = useState<RangeDays>(30);
  const [series, setSeries] = useState<
    Record<RangeDays, ConversationsSeriesPoint[] | null>
  >({ 7: null, 30: null, 90: null });
  const [seriesLoading, setSeriesLoading] = useState(true);

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(true);

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(
    null
  );
  const [responseTimeLoading, setResponseTimeLoading] = useState(true);

  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  // Deal analytics are per pipeline — a weighted value that mixed a sales
  // funnel with an operational one would be a number about nothing. This
  // moved here from the CRM board, where six metric tiles sat above the
  // columns competing with the work.
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState<string>('');
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  useEffect(() => {
    if (!allowed) return;
    const db = createClient();
    let cancelled = false;

    // Everything in parallel, each settling on its own — one slow query must
    // not hold the whole page blank.
    loadMetrics(db).then((d) => {
      if (cancelled) return;
      setMetrics(d);
      setMetricsLoading(false);
    });
    loadConversationsSeries(db, 30).then((d) => {
      if (cancelled) return;
      setSeries((prev) => ({ ...prev, 30: d }));
      setSeriesLoading(false);
    });
    loadPipelineDonut(db).then((d) => {
      if (cancelled) return;
      setPipeline(d);
      setPipelineLoading(false);
    });
    loadResponseTime(db).then((d) => {
      if (cancelled) return;
      setResponseTime(d);
      setResponseTimeLoading(false);
    });
    loadActivity(db).then((d) => {
      if (cancelled) return;
      setActivity(d);
      setActivityLoading(false);
    });
    db.from('pipelines')
      .select('*')
      .order('created_at')
      .then(({ data }) => {
        if (cancelled || !data?.length) return;
        setPipelines(data as Pipeline[]);
        setPipelineId((current) => current || (data[0] as Pipeline).id);
      });

    return () => {
      cancelled = true;
    };
  }, [allowed]);

  useEffect(() => {
    if (!pipelineId) return;
    const db = createClient();
    let cancelled = false;

    Promise.all([
      db
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('position'),
      db
        .from('deals')
        .select('*, assignee:profiles(*)')
        .eq('pipeline_id', pipelineId),
    ]).then(([stagesRes, dealsRes]) => {
      if (cancelled) return;
      setStages((stagesRes.data ?? []) as PipelineStage[]);
      setDeals((dealsRes.data ?? []) as Deal[]);
    });

    return () => {
      cancelled = true;
    };
  }, [pipelineId]);

  const handleRangeChange = useCallback(
    (next: RangeDays) => {
      setRange(next);
      if (series[next]) return;
      setSeriesLoading(true);
      loadConversationsSeries(createClient(), next).then((d) => {
        setSeries((prev) => ({ ...prev, [next]: d }));
        setSeriesLoading(false);
      });
    },
    [series]
  );

  // Nothing is known yet — show the shape of the page, not a verdict on it.
  if (profileLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!allowed) {
    // The header renders here too. Denying somebody is not a reason to stop
    // telling them where they are: this branch returned before the
    // <PageHeader>, so the route lost its <h1> entirely and the only title
    // on the document was the panel's own line. On desktop, where the top
    // bar carries no page title, a blocked user had the word "Relatórios"
    // nowhere on screen.
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} />
        <StatePanel
          size="md"
          icon={Lock}
          title={t('restrictedTitle')}
          description={t('restrictedBody')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      {/* ---------------------------------------------------- Comercial */}
      <section>
        <SectionTitle>
          <BarChart3 />
          {t('sectionCommercial')}
        </SectionTitle>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricsLoading || !metrics ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <Metric
                label={t('activeConversations')}
                value={metrics.activeConversations.current.toLocaleString(APP_LOCALE)}
              />
              <Metric
                label={t('newContactsToday')}
                value={metrics.newContactsToday.current.toLocaleString(APP_LOCALE)}
                delta={pctChange(
                  metrics.newContactsToday.current,
                  metrics.newContactsToday.previous
                )}
              />
              <Metric
                label={t('openDealsValue')}
                value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
                note={t('openDeals', { count: metrics.openDealsCount })}
              />
              <Metric
                label={t('messagesSentToday')}
                value={metrics.messagesSentToday.current.toLocaleString(APP_LOCALE)}
                delta={pctChange(
                  metrics.messagesSentToday.current,
                  metrics.messagesSentToday.previous
                )}
              />
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-full min-w-0">
            <ConversationsChart
              series={series}
              loading={seriesLoading}
              range={range}
              onRangeChange={handleRangeChange}
            />
          </div>
          <div className="h-full min-w-0">
            <PipelineDonut
              data={pipeline}
              loading={pipelineLoading}
              currency={defaultCurrency}
            />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- Funil */}
      {pipelines.length > 0 && stages.length > 0 && (
        <section>
          <SectionTitle>
            <GitBranch />
            {t('sectionPipeline')}
          </SectionTitle>
          {pipelines.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {pipelines.map((pipe) => (
                <button
                  key={pipe.id}
                  type="button"
                  onClick={() => setPipelineId(pipe.id)}
                  aria-pressed={pipe.id === pipelineId}
                  // Raw <button>, so the shell's 44px coarse-pointer rule for
                  // [data-slot="button"] does not apply — the minimum is
                  // spelled out here, and only under a coarse pointer, so the
                  // desktop chip row keeps its 28px.
                  className={cn(
                    'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold [@media(pointer:coarse)]:min-h-11',
                    pipe.id === pipelineId
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground transition-colors'
                  )}
                >
                  {pipe.name}
                </button>
              ))}
            </div>
          )}
          <PipelineAnalytics stages={stages} deals={deals} />
        </section>
      )}

      {/* ------------------------------------------- Dependeu de alguém */}
      <section>
        <SectionTitle tone="human">
          <Users />
          {t('sectionHuman')}
        </SectionTitle>
        <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />
        <div className="mt-4">
          {/* Cross-module history — messages, deals, broadcasts, automations.
              It reads as "what happened", which is the owner's question; the
              agent's landing page asks "what has to happen". */}
          <ActivityFeed items={activity} loading={activityLoading} />
        </div>
      </section>

      {/* ------------------------------------------------ Aguardando dado */}
      <section>
        <SectionTitle tone="auto">
          <Zap />
          {t('sectionPending')}
        </SectionTitle>
        {/* Named rather than silently omitted. These four are the reports the
            design calls for and the schema cannot answer yet: a funnel and a
            time-per-stage need a record of stage TRANSITIONS, and `deals`
            keeps only the stage a deal is in right now. Loss reasons and call
            logs have nowhere to be stored at all.

            Showing the gap beats showing a number derived from the wrong
            column — `updated_at` moves on any edit, so "days in stage" built
            from it would look plausible and be wrong. */}
        <Panel>
          <PanelHeader>
            <div>
              <PanelTitle>{t('pendingTitle')}</PanelTitle>
              <PanelSub>{t('pendingSub')}</PanelSub>
            </div>
          </PanelHeader>
          <PanelBody>
            <ul className="text-muted-foreground space-y-1.5 text-xs">
              {['funnel', 'timeInStage', 'lossReasons', 'calls'].map((key) => (
                <li key={key} className="flex gap-2">
                  <span aria-hidden className="text-border">
                    —
                  </span>
                  {t(`pending.${key}`)}
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      </section>
    </div>
  );
}

/**
 * Percent change against the previous period, or null when there is no basis.
 *
 * Growth from zero is not "+100%" and not "+∞" — it is a number with no
 * denominator, and printing one anyway is how a dashboard starts lying on its
 * first quiet week.
 */
function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}
