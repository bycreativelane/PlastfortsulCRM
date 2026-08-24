'use client';

import { useId, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquare } from 'lucide-react';
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts';

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
  ChartGrid,
  ChartLegend,
  ChartSurface,
  ChartTooltipCard,
  CURSOR_LINE,
  axisProps,
  axisTick,
} from '@/components/charts/chart-primitives';
import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

type RangeDays = 7 | 30 | 90;

interface ConversationsChartProps {
  /** Per-range data, so switching tabs never re-fetches. */
  series: Record<RangeDays, ConversationsSeriesPoint[] | null>;
  loading: boolean;
  range: RangeDays;
  onRangeChange: (r: RangeDays) => void;
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
  series,
  loading,
  range,
  onRangeChange,
}: ConversationsChartProps) {
  const t = useTranslations('Dashboard.conversationsChart');
  const gradientId = useId();
  const data = series[range];

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
        <PanelActions>
          {/* The inbox's `SegBar` geometry at a smaller size — same track,
              same radius, same lifted active chip. It used to be a
              `bg-muted/60` group with a `bg-secondary` active state, which
              is a third kind of segmented control in a product that
              already had two. */}
          <div className="bg-muted flex gap-0.5 rounded-lg p-[3px]">
            {[7, 30, 90].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRangeChange(r as RangeDays)}
                aria-pressed={range === r}
                className={cn(
                  // Raw <button>: the shell's coarse-pointer rule only
                  // widens [data-slot="button"], and these three sit ~26px
                  // tall on a phone. The minimum applies under a coarse
                  // pointer only, so the desktop segment keeps its size.
                  'text-2xs h-6.5 rounded-md px-2.5 font-semibold transition-colors [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
                  range === r
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-secondary-foreground hover:text-foreground'
                )}
              >
                {t('days', { count: r })}
              </button>
            ))}
          </div>
        </PanelActions>
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
            <ChartLegend
              className="mb-3"
              items={[
                { label: t('incoming'), color: 'var(--chart-1)' },
                { label: t('outgoing'), color: 'var(--chart-2)' },
              ]}
            />
            <ChartSurface>
              <AreaChart
                data={data}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                accessibilityLayer
                role="img"
                aria-label={t('ariaLabel')}
              >
                <defs>
                  {/* Reaching zero at the baseline is what lets the two
                      series sit on top of each other. A flat 15% fill on
                      both turns the overlap into a third colour that means
                      nothing. */}
                  <linearGradient
                    id={`${gradientId}-in`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--chart-1)"
                      stopOpacity={0.28}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--chart-1)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient
                    id={`${gradientId}-out`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--chart-2)"
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--chart-2)"
                      stopOpacity={0}
                    />
                  </linearGradient>
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
                  width={36}
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
                  fill={`url(#${gradientId}-out)`}
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
                  fill={`url(#${gradientId}-in)`}
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
