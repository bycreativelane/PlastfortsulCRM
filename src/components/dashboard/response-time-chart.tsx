'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ResponseTimeSummary } from '@/lib/dashboard/types';
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
  ChartGradient,
  ChartGrid,
  ChartSurface,
  ChartTooltipCard,
  CURSOR_FILL,
  Y_AXIS_WIDTH,
  axisProps,
  axisTick,
  gradientFill,
} from '@/components/charts/chart-primitives';
import { Skeleton } from './skeleton';

interface ResponseTimeChartProps {
  data: ResponseTimeSummary | null;
  loading: boolean;
  /** Minutes. Drawn as the dashed line the bars are read against. */
  thresholdMinutes?: number;
}

interface Row {
  day: string;
  /** Null when the day has no samples — see the note on the mapping. */
  minutes: number | null;
  samples: number;
}

/**
 * Mon…Sun in the app's language.
 *
 * This axis was reading "Mon Tue Wed Thu Fri Sat Sun" on a Portuguese
 * install. `DOW_SHORT_MON_FIRST` in `date-utils` is a hard-coded English
 * array — fine as the internal ordering key it is used as elsewhere, and
 * wrong the moment it is painted on a screen. It stays where it is,
 * unchanged, along with the test that pins it; the LABEL is a different
 * concern and belongs to the locale.
 *
 * 2026-05-18 is a Monday (the same anchor `date-utils.test.ts` uses), so
 * +i walks Monday-first and lines up with `mondayIndex`. Built from parts
 * rather than parsed, for the timezone reason spelled out on the other
 * chart. Module scope is safe: `APP_LOCALE` is a build-time public env
 * var, identical on server and client, so there is nothing to hydrate
 * differently.
 *
 * The trailing period pt-BR puts on "seg." is dropped. At 10px on an axis
 * it is not punctuation, it is a smudge.
 */
const DOW_LABELS = Array.from({ length: 7 }, (_, i) =>
  new Date(2026, 4, 18 + i)
    .toLocaleDateString(APP_LOCALE, { weekday: 'short' })
    .replace(/\.$/, '')
);

/**
 * Average first-response time, by weekday.
 *
 * Was the vendored Tremor `BarChart`, which is still the right component
 * for the AI usage panel in Settings but was the wrong one here: it ships
 * its own tooltip (`text-sm`, `px-4`, `shadow-md`) next to a hand-rolled
 * one (`text-2xs`, `px-2.5`, `shadow-lg`) on the same screen, and it does
 * not expose Recharts primitives — so the target, which is the whole
 * reason this chart has a y-axis, was exiled to a chip in the header with
 * a comment promising a follow-up. This is the follow-up. The target is a
 * `ReferenceLine` again, where a target belongs: on the axis, with the
 * bars crossing it.
 *
 * No colour on the over-target bars. The dashed line already says which
 * days missed, and a second channel saying the same thing is the mistake
 * the `Panel` gave up its accent bar to stop making. Amber in this system
 * means a person has something to do; a Tuesday three weeks ago does not.
 *
 * Days with no samples draw NO bar rather than a zero. `avgMinutes ?? 0`
 * put a slot on the axis that reads as "answered instantly" for a day
 * nobody wrote in — the fastest possible response time, rendered for the
 * absence of any response at all.
 */
export function ResponseTimeChart({
  data,
  loading,
  thresholdMinutes = 5,
}: ResponseTimeChartProps) {
  const t = useTranslations('Dashboard.responseTimeChart');
  const gradientId = useId();
  const hasData = data?.buckets.some((b) => b.avgMinutes != null) ?? false;

  const rows: Row[] =
    data?.buckets.map((b, i) => ({
      day: DOW_LABELS[i],
      minutes: b.avgMinutes,
      samples: b.samples,
    })) ?? [];

  return (
    <Panel>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>{t('title')}</PanelTitle>
          <PanelSub>{t('description')}</PanelSub>
        </div>
        <PanelActions className="gap-3 text-right text-xs">
          {/* The "meta 5min" chip that used to sit here is now the line's
              own label — one statement of the target, on the thing it is a
              target for. */}
          {data && (data.thisWeekAvg != null || data.lastWeekAvg != null) && (
            <div>
              <div className="text-muted-foreground">
                {t('thisWeek')}{' '}
                <span className="text-foreground font-medium tabular-nums">
                  {fmt(data.thisWeekAvg)}
                </span>
              </div>
              <div className="text-muted-foreground">
                {t('lastWeek')}{' '}
                <span className="tabular-nums">{fmt(data.lastWeekAvg)}</span>
              </div>
            </div>
          )}
        </PanelActions>
      </PanelHeader>

      <PanelBody>
        {loading || !data ? (
          <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />
        ) : !hasData ? (
          <StatePanel
            icon={Clock}
            title={t('noReplies')}
            description={t('noRepliesHint')}
          />
        ) : (
          <ChartSurface>
            <BarChart
              data={rows}
              margin={CHART_MARGIN}
              barCategoryGap="28%"
              accessibilityLayer
              role="img"
              aria-label={t('ariaLabel')}
            >
              <defs>
                {/* The bars are made of the same material as the areas on
                    the chart above — see `ChartGradient`. They were a flat
                    `var(--chart-1)`, which on the same page as two
                    dissolving areas read as a block of paint rather than a
                    quantity. The ramp stops at 55% rather than 0: an area
                    has a stroke along its top edge holding the shape
                    together, and a bar does not, so a bar that faded all
                    the way out would lose its own footing on the axis. */}
                <ChartGradient
                  id={`${gradientId}-bar`}
                  color="var(--chart-1)"
                  from={0.95}
                  to={0.55}
                />
              </defs>

              <ChartGrid />

              <XAxis
                {...axisProps}
                dataKey="day"
                tick={axisTick('translate(0, 6)')}
              />
              <YAxis
                {...axisProps}
                width={Y_AXIS_WIDTH}
                tickFormatter={(v: number) => `${v}m`}
                tick={axisTick('translate(-3, 0)')}
              />

              <Tooltip
                cursor={CURSOR_FILL}
                wrapperStyle={{ outline: 'none' }}
                animationDuration={120}
                content={({ active, payload, label }) => {
                  if (!active) return null;
                  // A day with no samples draws no bar, so Recharts hands
                  // back an EMPTY payload for it — the standard
                  // `!payload?.length → null` guard would make the one day
                  // that needs an explanation the only day with no readout
                  // at all. The label is still the category, so the row is
                  // recoverable from the data we already hold.
                  const row =
                    (payload?.[0]?.payload as Row | undefined) ??
                    rows.find((r) => r.day === label);
                  if (!row) return null;
                  return (
                    <ChartTooltipCard
                      heading={String(label)}
                      rows={[
                        {
                          label: t('average'),
                          value:
                            row.minutes == null
                              ? t('noSamples')
                              : fmt(row.minutes),
                          color: 'var(--chart-1)',
                        },
                      ]}
                      footer={
                        row.samples > 0
                          ? t('samples', { count: row.samples })
                          : undefined
                      }
                    />
                  );
                }}
              />

              {thresholdMinutes > 0 && (
                <ReferenceLine
                  y={thresholdMinutes}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: t('target', { minutes: thresholdMinutes }),
                    position: 'right',
                    className: 'text-3xs fill-muted-foreground',
                  }}
                />
              )}

              <Bar
                dataKey="minutes"
                fill={gradientFill(`${gradientId}-bar`)}
                radius={[4, 4, 0, 0]}
                maxBarSize={44}
                isAnimationActive={false}
              >
                {/* One <Cell> per row so a future rule can vary a single
                    day without reshaping the series. Today they are all
                    the accent — see the note above on why. */}
                {rows.map((row) => (
                  <Cell
                    key={row.day}
                    fill={gradientFill(`${gradientId}-bar`)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartSurface>
        )}
      </PanelBody>
    </Panel>
  );
}

function fmt(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`;
  if (mins < 60) return `${mins.toFixed(1)}m`;
  return `${(mins / 60).toFixed(1)}h`;
}
