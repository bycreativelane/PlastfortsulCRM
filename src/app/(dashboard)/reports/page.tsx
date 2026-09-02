'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  GitBranch,
  Lock,
  MessagesSquare,
  Send,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCapability } from '@/hooks/use-can';
import { formatCurrency } from '@/lib/currency';
import {
  loadActivity,
  loadConversationsPrevious,
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
import { periodFromPreset, type Period } from '@/lib/dashboard/period';
import { TooManyRowsError } from '@/lib/supabase/paged';
import type { Deal, Pipeline, PipelineStage } from '@/types';

import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { TeamPerformance } from '@/components/reports/team-performance';
import { TemplateUsage } from '@/components/reports/template-usage';
import { ConversationsChart } from '@/components/dashboard/conversations-chart';
import { PipelineFunnel } from '@/components/dashboard/pipeline-funnel';
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart';
import { PipelineAnalytics } from '@/components/pipelines/pipeline-analytics';
import { MetricStrip } from '@/components/dashboard/metric-strip';
import { PeriodPicker } from '@/components/dashboard/period-picker';
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
import { PageActions } from '@/components/layout/page-actions';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { cn } from '@/lib/utils';

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
  const { defaultCurrency, profileLoading } = useAuth();
  // A CAPABILITY, not the role, since migration 050. Admin is still the
  // default answer — see `CAPABILITIES['reports.view']` — but an account
  // can now let one agent in here, or keep one admin out, from
  // Configurações › Acesso. The sidebar row is gated on the same
  // capability, so the menu and the page agree.
  //
  // The gate below still waits on `profileLoading`: the role is null
  // until the profile fetch settles, and the shell's own gate only waits
  // on the SESSION. The owner of the account used to be told "Acesso
  // restrito" on every load of this page, for as long as the profile
  // took to arrive. A permission system that denies you and then changes
  // its mind is one you stop trusting — the cost is not the frame, it is
  // the credibility.
  const allowed = useCapability('reports.view');

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  /**
   * The window this page is about.
   *
   * A `Period` rather than a day count since the custom range landed:
   * "the last 30 days" and "July" are the same question with different
   * bounds, and only the first can be written as a number.
   */
  const [period, setPeriod] = useState<Period>(() => periodFromPreset(30));
  const [seriesLoading, setSeriesLoading] = useState(true);

  /**
   * Answers already fetched, keyed by the period that produced them.
   *
   * This used to be `Record<7 | 30 | 90, …>` — three slots for three
   * possible questions. A hand-picked window has no fixed set of keys,
   * so the cache is keyed on `period.key`, which is stable for the same
   * window and different for any other. Going back to a period you have
   * already looked at still costs nothing.
   */
  const [series, setSeries] = useState<
    Record<string, ConversationsSeriesPoint[] | undefined>
  >({});
  const [previous, setPrevious] = useState<
    Record<string, { incoming: number; outgoing: number } | undefined>
  >({});
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

  /**
   * What to do when the series query gives up.
   *
   * `TooManyRowsError` gets its own sentence because it is the only one
   * the reader can act on: the window they picked is bigger than this
   * page can add up in the browser, and a smaller one works. Everything
   * else is "it failed", which is all anybody can do anything with.
   */
  const failSeries = useCallback(
    (err: unknown) => {
      setSeriesLoading(false);
      toast.error(
        err instanceof TooManyRowsError ? t('periodTooBig') : t('loadFailed')
      );
    },
    [t]
  );

  useEffect(() => {
    if (!allowed) return;
    const db = createClient();
    let cancelled = false;

    // Everything in parallel, each settling on its own — one slow query must
    // not hold the whole page blank.
    //
    // AND EVERY ONE OF THEM CATCHES. None of these did: a rejection left
    // its `…Loading` flag true forever, so the panel showed a skeleton
    // that would never resolve, plus an unhandled rejection in the
    // console and nothing on screen. A failed query has to look like a
    // failure — clearing the flag lets the panel render its own empty
    // state, which says something true.
    loadMetrics(db)
      .then((d) => {
        if (cancelled) return;
        setMetrics(d);
        setMetricsLoading(false);
      })
      .catch(() => !cancelled && setMetricsLoading(false));
    const first = periodFromPreset(30);
    loadConversationsSeries(db, first)
      .then((d) => {
        if (cancelled) return;
        setSeries((prev) => ({ ...prev, [first.key]: d }));
        setSeriesLoading(false);
      })
      .catch((err) => !cancelled && failSeries(err));
    // Not awaited with the series and not gating `seriesLoading`: the
    // chart is readable the moment the points land, and a comparison
    // that arrives a beat later fills in beside a number already on
    // screen. Holding the whole panel for it would trade something
    // useful for something merely better.
    // The comparison is the one thing allowed to fail quietly: the chart
    // is complete without it, and its absence already reads as "no
    // basis" rather than as zero.
    loadConversationsPrevious(db, first)
      .then((d) => {
        if (cancelled) return;
        setPrevious((prev) => ({ ...prev, [first.key]: d }));
      })
      .catch(() => {});
    loadPipelineDonut(db)
      .then((d) => {
        if (cancelled) return;
        setPipeline(d);
        setPipelineLoading(false);
      })
      .catch(() => !cancelled && setPipelineLoading(false));
    loadResponseTime(db)
      .then((d) => {
        if (cancelled) return;
        setResponseTime(d);
        setResponseTimeLoading(false);
      })
      .catch(() => !cancelled && setResponseTimeLoading(false));
    loadActivity(db)
      .then((d) => {
        if (cancelled) return;
        setActivity(d);
        setActivityLoading(false);
      })
      .catch(() => !cancelled && setActivityLoading(false));
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

  const handlePeriodChange = useCallback(
    (next: Period) => {
      setPeriod(next);
      // Already answered — switching back to a window you have looked at
      // is instant, and asking again would be a round trip for a result
      // that is already on the client.
      if (series[next.key]) {
        setSeriesLoading(false);
        return;
      }
      setSeriesLoading(true);
      const db = createClient();
      loadConversationsSeries(db, next)
        .then((d) => {
          setSeries((prev) => ({ ...prev, [next.key]: d }));
          setSeriesLoading(false);
        })
        .catch(failSeries);
      loadConversationsPrevious(db, next)
        .then((d) => {
          setPrevious((prev) => ({ ...prev, [next.key]: d }));
        })
        .catch(() => {});
    },
    [series, failSeries]
  );

  // Nothing is known yet — show the shape of the page, not a verdict on it.
  if (profileLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        {/* THE SHAPE THAT RESOLVES, NOT FOUR EQUAL CARDS.
            This was `xl:grid-cols-4` with four `SkeletonCard`s, which
            is what the strip above used to be. It is now a 2/5 hero
            beside a 3/5 strip — so the page drew four boxes and then
            replaced them with two of different widths, which is the
            layout shift `SkeletonCard` exists to prevent, reintroduced
            one grid up from it.
            `MetricStrip` renders its own loading state at exactly the
            geometry it will resolve into, so the honest placeholder is
            the component itself with no data in it. The labels are the
            real ones: they do not move when the numbers arrive. */}
        <MetricStrip
          loading
          hero={{
            key: 'openDealsValue',
            label: t('openDealsValue'),
            window: t('windowNow'),
            icon: <Wallet />,
            value: '—',
          }}
          readings={[
            {
              key: 'activeConversations',
              label: t('activeConversations'),
              window: t('windowNow'),
              icon: <MessagesSquare />,
              value: '—',
            },
            {
              key: 'newContacts',
              label: t('newContacts'),
              window: t('windowToday'),
              icon: <UserPlus />,
              value: '—',
            },
            {
              key: 'messagesSent',
              label: t('messagesSent'),
              window: t('windowToday'),
              icon: <Send />,
              value: '—',
            },
          ]}
        />
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
      {/* The period, ON the title row rather than under it.
          It used to live inside one chart's header, which implied the
          whole page moved with it — and everything else here reports a
          fixed window. Promoted, it is the frame the page is read in,
          and each panel that keeps its own window says so in its
          subtitle.
          As a child of PageHeader it sat below a `max-w-2xl`
          description, so the top of the page was a title, a paragraph,
          and then a control, with the right two thirds of the row
          empty — "barra em cima tá com desperdício de espaço". In the
          actions slot it shares the title's row, which is where the
          empty space already was. */}
      <PageHeader title={t('title')} description={t('description')} />
      <PageActions>
        <PeriodPicker value={period} onChange={handlePeriodChange} />
      </PageActions>

      {/* ---------------------------------------------------- Comercial */}
      <section>
        <SectionTitle>
          <BarChart3 />
          {t('sectionCommercial')}
        </SectionTitle>

        {/* A HERO AND A STRIP — not four cards, and not four equal cells
            either. See the note in `MetricStrip`.

            The money is the hero because it is the only reading here
            that survives the question "why did you open Relatórios".
            Conversas ativas, novos contatos and mensagens enviadas are
            all counts of the operation running; R$ em aberto is the
            operation's reason for running, and it is the one number an
            owner repeats out loud.

            EVERY READING NAMES ITS WINDOW, because none of the four
            follows the period picker sitting directly above them. Two
            are states of right now and two are counts of today, on a
            page whose header says 30 dias. Saying so costs one word per
            cell; not saying so taught the reader that the control does
            nothing. */}
        <MetricStrip
          loading={metricsLoading || !metrics}
          hero={{
            key: 'openDealsValue',
            label: t('openDealsValue'),
            window: t('windowNow'),
            icon: <Wallet />,
            value: metrics
              ? formatCurrency(metrics.openDealsValue, defaultCurrency)
              : '—',
            note: metrics
              ? t('openDeals', { count: metrics.openDealsCount })
              : undefined,
          }}
          readings={[
            {
              key: 'activeConversations',
              label: t('activeConversations'),
              window: t('windowNow'),
              icon: <MessagesSquare />,
              value:
                metrics?.activeConversations.current.toLocaleString(
                  APP_LOCALE
                ) ?? '—',
              // NO DELTA, deliberately. `activeConversations.previous`
              // is not yesterday's open count — nothing snapshots that —
              // it is the difference between conversations OPENED today
              // and yesterday, which is a different quantity wearing the
              // same field name. A percentage built from it would be
              // arithmetic on two unrelated numbers.
            },
            {
              key: 'newContacts',
              label: t('newContacts'),
              window: t('windowToday'),
              icon: <UserPlus />,
              value:
                metrics?.newContactsToday.current.toLocaleString(APP_LOCALE) ??
                '—',
              delta: metrics
                ? pctChange(
                    metrics.newContactsToday.current,
                    metrics.newContactsToday.previous
                  )
                : null,
              deltaLabel: t('vsYesterday'),
            },
            {
              key: 'messagesSent',
              label: t('messagesSent'),
              window: t('windowToday'),
              icon: <Send />,
              value:
                metrics?.messagesSentToday.current.toLocaleString(APP_LOCALE) ??
                '—',
              delta: metrics
                ? pctChange(
                    metrics.messagesSentToday.current,
                    metrics.messagesSentToday.previous
                  )
                : null,
              deltaLabel: t('vsYesterday'),
            },
          ]}
        />

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-full min-w-0">
            <ConversationsChart
              data={series[period.key] ?? null}
              previous={previous[period.key] ?? null}
              loading={seriesLoading}
            />
          </div>
          <div className="h-full min-w-0">
            {/* A funnel, not a ring. Stages are a sequence and the
                question is where deals die — see the note at the top of
                the component. The dashboard keeps the donut: there the
                panel answers "how is the pipeline split right now", which
                is the one question a ring is good at. */}
            <PipelineFunnel
              data={pipeline}
              loading={pipelineLoading}
              currency={defaultCurrency}
            />
          </div>
        </div>

        {/* Individual performance, under the funnel. It answers a
            different question than everything above it — those are about
            the business, this is about people — so it gets its own row
            rather than a column beside a chart. */}
        <div className="mt-4">
          <TeamPerformance period={period} />
        </div>
      </section>

      {/* ---------------------------------------------- Custo de envio */}
      {/* Depois de Comercial e antes do funil: receita, depois custo.
          É a ordem em que o dono lê a operação, e a razão de não ser
          uma aba de Configurações — quanto o WhatsApp custou no mês é
          uma pergunta de relatório, não de ajuste. */}
      <section>
        <SectionTitle>
          <Send />
          {t('sectionUsage')}
        </SectionTitle>
        <TemplateUsage period={period} />
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
                      ? 'border-primary-soft-2 bg-primary-soft text-primary'
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
        {/* Two up, the same rhythm the Comercial section above uses.
            Stacked full-width, the bar chart got the whole 1300px of a
            desktop page for SEVEN categories — `maxBarSize` caps each bar
            at 44px, so what widened was the gaps, and a week of response
            times read as seven lonely sticks. Beside the feed each panel
            gets ~640px, which is the width the chart was designed at.

            The two also happen to be the same height at rest: a 260px plot
            under a header, against the feed's five rows under a header and
            over its footer. Expanding the feed to 50 rows does stretch the
            row — but that is a state somebody asked for, not the one the
            page loads in. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ResponseTimeChart
            data={responseTime}
            loading={responseTimeLoading}
          />
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
