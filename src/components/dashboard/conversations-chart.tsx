'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquare } from 'lucide-react';
import { Bar, BarChart, Tooltip, XAxis, YAxis } from 'recharts';

import type { ConversationsSeriesPoint } from '@/lib/dashboard/types';
import { APP_LOCALE } from '@/lib/i18n/locale';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { StatePanel } from '@/components/ui/state-panel';
import {
  CHART_HEIGHT,
  CHART_MARGIN,
  ChartGrid,
  ChartLegend,
  ChartSurface,
  ChartTooltipCard,
  CURSOR_FILL,
  Y_AXIS_WIDTH,
  axisProps,
  axisTick,
  niceScale,
} from '@/components/charts/chart-primitives';
import { bucketSeries, type Bucket } from './bucket-series';
import { Skeleton } from './skeleton';

interface ConversationsChartProps {
  /**
   * The points for the period on screen, or null while they load.
   *
   * Always DAILY, whatever the panel ends up drawing. Bucketing is a
   * presentation decision and it is made here, where the width of the
   * panel is known; the query stays the same one for every period.
   */
  data: ConversationsSeriesPoint[] | null;
  /**
   * Totals for the window before this one. Optional: a caller that does
   * not ask the question gets a readout with no deltas rather than one
   * claiming zero change.
   */
  previous?: { incoming: number; outgoing: number } | null;
  loading: boolean;
}

/**
 * Message volume in and out — grouped bars, ONE HUE, AND ONLY AS MANY
 * MARKS AS THE PANEL CAN HOLD CALMLY.
 *
 * ------------------------------------------------------------------
 * THE MARK COUNT IS THE DESIGN
 * ------------------------------------------------------------------
 *
 * Thirty days times two series is sixty marks in a 690px panel. Every
 * one of them was accurate and the panel read as noise — a picket fence
 * you scan rather than a chart you read. The dashboards this borrows
 * from draw five groups of two. That is not them having less data; it
 * is them deciding that a monthly panel answers a question about weeks.
 *
 * So the series is BUCKETED to fit, and the subtitle says which unit it
 * ended up in:
 *
 *   up to 14 points   →  a bar per day
 *   up to 70          →  a bar per week    (30 days ⇒ 5 groups)
 *   beyond            →  a bar per month   (90 days ⇒ 3 groups)
 *
 * Buckets are cut from the MOST RECENT end backwards, so the last one
 * is the week you are in and the older ones are whole. Cutting from the
 * start instead leaves a ragged partial bucket on the right, which is
 * the one everybody reads first.
 *
 * ------------------------------------------------------------------
 * ONE HUE, TWO WEIGHTS
 * ------------------------------------------------------------------
 *
 * Received is the accent at full strength; sent is the same accent at
 * a third of it. It was two different hues, which is one more colour than the
 * panel needs to say a thing that is not a category difference —
 * "recebidas" and "enviadas" are two directions of one flow, and the
 * eye reads a lighter version of the same colour as exactly that.
 *
 * It also frees the only saturated colour on the panel to mean
 * something. With two hues, nothing on the chart was emphasised because
 * everything was.
 *
 * ------------------------------------------------------------------
 * SIDE BY SIDE, NOT MIRRORED
 * ------------------------------------------------------------------
 *
 * The previous version put received above a zero rule and sent below
 * it. It reads well and it is heavy: a full-height axis of ink through
 * the middle of the panel, and every quiet day still spending a slot.
 * Grouped pairs sit on one baseline, use half the vertical ink, and
 * answer the same question — a pair where the left bar overtops the
 * right one is a week that took in more than it answered.
 */
export function ConversationsChart({
  data,
  previous,
  loading,
}: ConversationsChartProps) {
  const t = useTranslations('Dashboard.conversationsChart');

  /**
   * What the two series add up to over the window on screen.
   *
   * Off the RAW points, never the buckets — bucketing must not be able
   * to change a total. Computed here rather than fetched: the points
   * are already loaded and a sum of at most ninety numbers is cheaper
   * than the round trip that would tell us the same thing.
   */
  const totals = useMemo(() => {
    const rows = data ?? [];
    return {
      incoming: rows.reduce((n, r) => n + r.incoming, 0),
      outgoing: rows.reduce((n, r) => n + r.outgoing, 0),
    };
  }, [data]);

  /**
   * Percent change against the window before this one.
   *
   * `null` when there is no basis — and NOT zero. A period with nothing
   * before it is not a period that held steady, and printing "0%" would
   * claim a measurement nobody took. Same rule the metric strip follows.
   */
  const change = useMemo(() => {
    const before = previous;
    if (!before) return { incoming: null, outgoing: null };
    const pct = (now: number, then: number) =>
      then === 0 ? null : Math.round(((now - then) / then) * 100);
    return {
      incoming: pct(totals.incoming, before.incoming),
      outgoing: pct(totals.outgoing, before.outgoing),
    };
  }, [previous, totals]);

  const { unit, buckets } = useMemo(() => bucketSeries(data ?? []), [data]);

  const { max, ticks } = useMemo(() => {
    const peak = buckets.reduce(
      (m, b) => Math.max(m, b.incoming, b.outgoing),
      0
    );
    // Three gridlines, not five. The panel is calmer for it and no
    // reading on a bar chart of counts needs a rule every 20%.
    return niceScale(peak, { integer: true, targetTicks: 3 });
  }, [buckets]);

  const empty =
    !!data && data.every((p) => p.incoming === 0 && p.outgoing === 0);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>{t('title')}</PanelTitle>
          {/* The subtitle names the UNIT, because the panel chose it.
              A chart that silently switches from days to weeks when the
              period grows is a chart that quietly changed the question
              — and the reader would be comparing five bars against the
              memory of thirty. */}
          <PanelSub>{t(`per.${unit}`)}</PanelSub>
        </div>
        {!loading && data && !empty ? (
          <PanelActions>
            <ChartLegend
              items={[
                {
                  label: t('incoming'),
                  color: INCOMING,
                  total: totals.incoming.toLocaleString(APP_LOCALE),
                  delta: change.incoming,
                },
                {
                  label: t('outgoing'),
                  color: OUTGOING,
                  total: totals.outgoing.toLocaleString(APP_LOCALE),
                  delta: change.outgoing,
                },
              ]}
            />
          </PanelActions>
        ) : null}
      </PanelHeader>

      <PanelBody className="flex min-h-0 flex-1 flex-col justify-center">
        {loading || !data ? (
          <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />
        ) : empty ? (
          <StatePanel
            icon={MessageSquare}
            title={t('noActivity')}
            description={t('noActivityHint')}
          />
        ) : (
          <ChartSurface fill>
            <BarChart
              data={buckets}
              margin={CHART_MARGIN}
              // The air is the point. `barGap` is the 4px between the
              // two bars OF a group — enough to read them as two, small
              // enough to read them as a pair — and `barCategoryGap`
              // hands better than a third of the axis back to the
              // background.
              barGap={4}
              barCategoryGap="38%"
              accessibilityLayer
              role="img"
              aria-label={t('ariaLabel')}
            >
              <ChartGrid />

              <XAxis
                {...axisProps}
                dataKey="label"
                tick={axisTick('translate(0, 6)')}
              />
              <YAxis
                {...axisProps}
                width={Y_AXIS_WIDTH}
                domain={[0, max]}
                ticks={ticks}
                allowDecimals={false}
                tick={axisTick('translate(-3, 0)')}
              />

              <Tooltip
                cursor={CURSOR_FILL}
                wrapperStyle={{ outline: 'none' }}
                animationDuration={120}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as Bucket | undefined;
                  if (!row) return null;
                  return (
                    <ChartTooltipCard
                      heading={row.heading}
                      rows={[
                        {
                          label: t('incoming'),
                          value: row.incoming.toLocaleString(APP_LOCALE),
                          color: INCOMING,
                        },
                        {
                          label: t('outgoing'),
                          value: row.outgoing.toLocaleString(APP_LOCALE),
                          color: OUTGOING,
                        },
                      ]}
                    />
                  );
                }}
              />

              {/* `radius` on the top corners only: a rounded bottom
                  would lift the bar off the baseline it is measured
                  from. 6px on a ~20px bar is the reference's silhouette
                  — a soft cap, not a pill. */}
              <Bar
                dataKey="incoming"
                fill={INCOMING}
                radius={[6, 6, 0, 0]}
                maxBarSize={26}
                isAnimationActive={false}
              />
              <Bar
                dataKey="outgoing"
                fill={OUTGOING}
                radius={[6, 6, 0, 0]}
                maxBarSize={26}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartSurface>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * The two weights of the one hue.
 *
 * Module constants rather than literals at four call sites, because the
 * legend dot, the bar and the tooltip swatch have to be the same colour
 * or the key stops being a key.
 */
const INCOMING = 'var(--chart-1)';
const OUTGOING = 'color-mix(in oklab, var(--chart-1) 32%, transparent)';
