'use client';

import { useId, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquare } from 'lucide-react';
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts';

import type { ConversationsSeriesPoint } from '@/lib/dashboard/types';
import { APP_LOCALE } from '@/lib/i18n/locale';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { StatePanel } from '@/components/ui/state-panel';
import {
  CHART_HEIGHT,
  CHART_MARGIN,
  ChartGradient,
  ChartGrid,
  ChartLegend,
  ChartSurface,
  ChartTooltipCard,
  CURSOR_LINE,
  Y_AXIS_WIDTH,
  axisProps,
  axisTick,
  gradientFill,
} from '@/components/charts/chart-primitives';
import { Skeleton } from './skeleton';

interface ConversationsChartProps {
  /**
   * The points for the period on screen, or null while they load.
   *
   * This used to be a `Record<7 | 30 | 90, …>` and the panel picked one,
   * because the panel owned the period control. It does not any more —
   * the control is the page's, and since the period became an arbitrary
   * window there is no fixed set of keys to hold a record of. Caching
   * moved up to the page, keyed on the period itself.
   */
  data: ConversationsSeriesPoint[] | null;
  /**
   * Totals for the window before this one. Optional: a caller that does
   * not ask the question gets a legend with no deltas rather than one
   * claiming zero change.
   */
  previous?: { incoming: number; outgoing: number } | null;
  loading: boolean;
}

/**
 * Daily message volume, in and out.
 *
 * Areas rather than two bare polylines. The question this chart answers is
 * "how much", and a line only encodes the top edge of an amount — the eye
 * has to measure down to an axis that is 600px away to read it. A filled
 * area puts the quantity on screen as quantity. The fills are gradients
 * that reach zero at the baseline so the two series can overlap without
 * the lower one turning into a muddy band.
 *
 * Reasoning kept from the hand-rolled version this replaces:
 *
 *   · `niceCeil` still sets the top of the axis. Recharts' own tick
 *     picker will happily label 0 · 1 · 2 · 3, and a chart whose axis
 *     changes shape every time a quiet day drops the maximum by one is a
 *     chart you cannot compare against yesterday's memory of it.
 *   · Series colour is `--chart-1` / `--chart-2`, never a hex. Both the
 *     accent and the mode move underneath this panel.
 *
 * Dropped with it: ~120 lines of `getScreenCTM()` hover math, the manual
 * label stride, and the tooltip that positioned itself against a
 * letterboxed viewBox. Recharts does all three, in real pixels.
 */
export function ConversationsChart({
  data,
  previous,
  loading,
}: ConversationsChartProps) {
  const t = useTranslations('Dashboard.conversationsChart');
  const gradientId = useId();

  /**
   * What the two series add up to over the window on screen.
   *
   * Computed here rather than fetched: the points are already loaded and
   * a sum of at most ninety numbers is cheaper than the round trip that
   * would tell us the same thing. Recomputed when the period changes,
   * which is exactly when the answer changes.
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

  const { maxY, ticks } = useMemo(() => {
    const arr = data ?? [];
    const max = arr.reduce((m, p) => Math.max(m, p.incoming, p.outgoing), 0);
    const ceil = niceCeil(max);
    const steps = [0, ceil / 4, ceil / 2, (3 * ceil) / 4, ceil].map((v) =>
      Math.round(v)
    );
    // De-dupe when the series is flat 0.
    return { maxY: ceil, ticks: Array.from(new Set(steps)) };
  }, [data]);

  const empty =
    !!data && data.every((p) => p.incoming === 0 && p.outgoing === 0);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>{t('title')}</PanelTitle>
          <PanelSub>{t('description')}</PanelSub>
        </div>
      </PanelHeader>

      <PanelBody className="flex flex-1 flex-col">
        {loading || !data ? (
          <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />
        ) : empty ? (
          <StatePanel
            icon={MessageSquare}
            title={t('noActivity')}
            description={t('noActivityHint')}
          />
        ) : (
          <>
            {/* The legend carries the period totals now. Two words and
                two dots above a chart is a colour key read once and then
                paid for on every visit; with the numbers in it, the line
                answers "quantas, no total?" before anybody hovers a
                single point. */}
            <ChartLegend
              className="mb-3"
              items={[
                {
                  label: t('incoming'),
                  color: 'var(--chart-1)',
                  total: totals.incoming.toLocaleString(APP_LOCALE),
                  delta: change.incoming,
                },
                {
                  label: t('outgoing'),
                  color: 'var(--chart-2)',
                  total: totals.outgoing.toLocaleString(APP_LOCALE),
                  delta: change.outgoing,
                },
              ]}
            />
            <ChartSurface>
              <AreaChart
                data={data}
                margin={CHART_MARGIN}
                accessibilityLayer
                role="img"
                aria-label={t('ariaLabel')}
              >
                <defs>
                  {/* Reaching zero at the baseline is what lets the two
                      series sit on top of each other. A flat 15% fill on
                      both turns the overlap into a third colour that means
                      nothing. Both ramps now come from `ChartGradient`, the
                      same one the bars use — see the note there. */}
                  <ChartGradient
                    id={`${gradientId}-in`}
                    color="var(--chart-1)"
                    from={0.28}
                  />
                  <ChartGradient
                    id={`${gradientId}-out`}
                    color="var(--chart-2)"
                    from={0.2}
                  />
                </defs>

                <ChartGrid />

                <XAxis
                  {...axisProps}
                  dataKey="day"
                  tickFormatter={shortDayLabel}
                  // Recharts drops labels that would collide, which is the
                  // same job the old `labelStride` did by hand — except it
                  // measures the rendered text instead of assuming six fit.
                  minTickGap={24}
                  tick={axisTick('translate(0, 6)')}
                />
                <YAxis
                  {...axisProps}
                  width={Y_AXIS_WIDTH}
                  domain={[0, maxY]}
                  ticks={ticks}
                  allowDecimals={false}
                  tick={axisTick('translate(-3, 0)')}
                />

                <Tooltip
                  cursor={CURSOR_LINE}
                  wrapperStyle={{ outline: 'none' }}
                  animationDuration={120}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const byKey = new Map(
                      payload.map((p) => [p.dataKey as string, Number(p.value)])
                    );
                    return (
                      <ChartTooltipCard
                        heading={longDayLabel(String(label))}
                        rows={[
                          {
                            label: t('incoming'),
                            value: (byKey.get('incoming') ?? 0).toLocaleString(
                              APP_LOCALE
                            ),
                            color: 'var(--chart-1)',
                          },
                          {
                            label: t('outgoing'),
                            value: (byKey.get('outgoing') ?? 0).toLocaleString(
                              APP_LOCALE
                            ),
                            color: 'var(--chart-2)',
                          },
                        ]}
                      />
                    );
                  }}
                />

                {/* Outgoing first, so the accent series draws on top. */}
                <Area
                  type="monotone"
                  dataKey="outgoing"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  fill={gradientFill(`${gradientId}-out`)}
                  dot={false}
                  // The ring is `--card`, not white: it is a hole punched
                  // in the line so the dot reads as a marker rather than a
                  // lump, and on the dark card white would be the lump.
                  activeDot={{
                    r: 3.5,
                    strokeWidth: 2,
                    stroke: 'var(--card)',
                    fill: 'var(--chart-2)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="incoming"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill={gradientFill(`${gradientId}-in`)}
                  dot={false}
                  activeDot={{
                    r: 3.5,
                    strokeWidth: 2,
                    stroke: 'var(--card)',
                    fill: 'var(--chart-1)',
                  }}
                />
              </AreaChart>
            </ChartSurface>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function shortDayLabel(key: string): string {
  // key is YYYY-MM-DD; return "17 abr"-style. Building the Date from parts
  // rather than parsing the string avoids the UTC-midnight shift that
  // moves a day backwards in every timezone west of Greenwich.
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
    month: 'short',
    day: 'numeric',
  });
}

function longDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Round `max` up to a "nice" number so Y-axis ticks feel natural
 * (1, 2, 5, 10, 20, 50, …). Keeps the chart readable even when the series
 * is small (max=3 becomes ceil=4, not 3).
 */
function niceCeil(max: number): number {
  if (max <= 0) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const normalised = max / pow;
  const nice =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return nice * pow;
}
