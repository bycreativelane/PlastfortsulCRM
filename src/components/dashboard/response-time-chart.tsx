'use client';

import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';

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
import { peakPercent } from '@/components/charts/chart-primitives';
import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

interface ResponseTimeChartProps {
  data: ResponseTimeSummary | null;
  loading: boolean;
  /** Minutes. The unit every row below is expressed in multiples of. */
  thresholdMinutes?: number;
}

/**
 * Mon…Sun in the app's language.
 *
 * `DOW_SHORT_MON_FIRST` in `date-utils` is a hard-coded English array —
 * fine as the internal ordering key it is used as elsewhere, and wrong
 * the moment it is painted on a screen. It stays where it is, along with
 * the test that pins it; the LABEL belongs to the locale.
 *
 * 2026-05-18 is a Monday (the same anchor `date-utils.test.ts` uses), so
 * +i walks Monday-first and lines up with `mondayIndex`. Built from parts
 * rather than parsed, for the timezone reason spelled out on the other
 * chart. Module scope is safe: `APP_LOCALE` is a build-time public env
 * var, identical on server and client, so there is nothing to hydrate
 * differently.
 *
 * The trailing period pt-BR puts on "seg." is dropped. At this size it is
 * not punctuation, it is a smudge.
 */
const DOW_LABELS = Array.from({ length: 7 }, (_, i) =>
  new Date(2026, 4, 18 + i)
    .toLocaleDateString(APP_LOCALE, { weekday: 'short' })
    .replace(/\.$/, '')
);

/**
 * First-response time by weekday, measured in MULTIPLES OF THE TARGET.
 *
 * ------------------------------------------------------------------
 * THE AXIS THIS REPLACES COULD NOT BE FIXED
 * ------------------------------------------------------------------
 *
 * It was seven upright bars on a minutes axis with the target drawn on
 * it. Every version of that chart had the same defect, and the defect is
 * arithmetic rather than taste: the target is five minutes and a real
 * week peaks near three hours, so the goal sits at 2.5% of the plot
 * height. As a dashed rule it was a pixel off the x-axis and read as the
 * axis. As a shaded band — the previous attempt — it was legible, and it
 * was still a sliver on the floor under seven columns that all looked
 * the same height.
 *
 * They looked the same height because they ARE, to the resolution of
 * that chart: 72 minutes and 180 minutes are both "vastly over", and a
 * linear axis spends its whole range separating two answers that are
 * the same answer. A log axis would separate them honestly and is not a
 * thing to hand somebody who runs a plastics distributor.
 *
 * So the MEASURE changes, which is the part a new set of marks could
 * never do. Each day says how many times the target it took — `36×` —
 * as text, rather than as a height the reader estimates off a scale.
 * The bar behind it is scaled to the SLOWEST day, so length answers the
 * one question a picture is good for here: if I fix a single day this
 * week, which one? The target stops being plotted at all, because
 * plotting it was the thing that never worked; it is named once in the
 * header, which is where a constant belongs.
 *
 * A day that beats the target does not print `0×`. It takes the
 * confirmed tone and says so in words — that is a different STATE, not a
 * smaller number, and the day it starts happening is the whole point of
 * the panel.
 *
 * ------------------------------------------------------------------
 * ROWS, NOT COLUMNS — AND NO CHART LIBRARY LEFT TO USE
 * ------------------------------------------------------------------
 *
 * Seven categories in a box twice as wide as it is tall is the shape
 * Recharts is worst at: `maxBarSize` caps the mark, so what widens is
 * the gaps, and the week read as seven lonely sticks. Sideways, each day
 * gets a full row, the label is horizontal and never truncated, and the
 * time and the multiple both fit as real text at the end of the bar.
 *
 * With no axis and no plot area there is nothing left for a charting
 * library to do, so there is no `ChartSurface` here — the panel is seven
 * flex rows. `peakPercent` is still the shared primitive doing the
 * scaling, so this panel and the funnel keep agreeing about what "share
 * of the biggest" means.
 *
 * Days with no samples draw NO bar and say so. `avgMinutes ?? 0` would
 * put a row on the panel reading as "answered instantly" — the fastest
 * response possible — for a day nobody wrote in.
 *
 * And every day that DOES draw prints how many conversations it is made
 * of, under its name. See the note on the row.
 */
export function ResponseTimeChart({
  data,
  loading,
  thresholdMinutes = 5,
}: ResponseTimeChartProps) {
  const t = useTranslations('Dashboard.responseTimeChart');

  const rows = (data?.buckets ?? []).map((bucket, i) => ({
    day: DOW_LABELS[i],
    minutes: bucket.avgMinutes,
    samples: bucket.samples,
  }));

  const measured = rows.filter((row) => row.minutes != null);
  const hasData = measured.length > 0;
  const values = measured.map((row) => row.minutes ?? 0);
  const slowest = values.reduce((worst, value) => Math.max(worst, value), 0);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>{t('title')}</PanelTitle>
          <PanelSub>{t('description')}</PanelSub>
        </div>
        <PanelActions className="gap-3 text-right text-xs">
          {/* The target, stated once, as the constant it is. Every row
              below is a multiple of this number so it has to be on
              screen — and the header is the only place on the panel
              where a value that never changes is not competing with
              seven that do. */}
          {thresholdMinutes > 0 && (
            <span className="border-border text-muted-foreground text-2xs inline-flex h-5 shrink-0 items-center rounded-full border px-2 whitespace-nowrap tabular-nums">
              {t('target', { minutes: thresholdMinutes })}
            </span>
          )}
          {data && (data.thisWeekAvg != null || data.lastWeekAvg != null) && (
            // `whitespace-nowrap`: beside the target chip these two
            // lines were breaking mid-label — "Semana / passada: 1h12" —
            // which turns a two-line readout into a four-line paragraph
            // in the corner of a header.
            <div className="whitespace-nowrap">
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

      <PanelBody className="flex min-h-0 flex-1 flex-col justify-center">
        {loading || !data ? (
          <ResponseSkeleton />
        ) : !hasData ? (
          <StatePanel
            icon={Clock}
            title={t('noReplies')}
            description={t('noRepliesHint')}
          />
        ) : (
          <ol className="space-y-2.5">
            {rows.map((row) => {
              const within =
                row.minutes != null &&
                thresholdMinutes > 0 &&
                row.minutes <= thresholdMinutes;
              const isSlowest =
                row.minutes != null && slowest > 0 && row.minutes === slowest;
              // Floored at 1: a day at four times the target rounds to
              // 4, a day at 1.4 rounds to 1, and a day at 0.9 is not
              // over at all — it took the `within` branch before it got
              // here. There is no reading of "0× a meta" that is true.
              const times =
                row.minutes != null && thresholdMinutes > 0
                  ? Math.max(1, Math.round(row.minutes / thresholdMinutes))
                  : null;

              return (
                <li
                  key={row.day}
                  className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-3"
                >
                  {/* THE SAMPLE COUNT IS NOT OPTIONAL INFORMATION.
                      "36× a meta" off two conversations is not a fact
                      about Wednesdays, and the row that says it looks
                      exactly like the row built from forty. The old
                      chart had this in a Recharts tooltip, which is to
                      say it had it for the people who hover — and
                      nobody hovers a weekday.
                      Same shape the funnel uses for the same job: the
                      label on top, how many it is made of underneath. */}
                  <div className="min-w-0 text-right">
                    <div
                      className={cn(
                        'text-2xs truncate leading-tight',
                        isSlowest
                          ? 'text-foreground font-bold'
                          : 'text-muted-foreground'
                      )}
                    >
                      {row.day}
                    </div>
                    {row.samples > 0 && (
                      <div className="text-muted-foreground text-3xs truncate leading-tight">
                        {t('samples', { count: row.samples })}
                      </div>
                    )}
                  </div>

                  {/* ONE BAR IN FULL STRENGTH: the slowest day. Every
                      other recedes to a wash of the same hue, so the
                      shape of the week still reads and the eye still
                      lands somewhere — and it answers what the dashed
                      rule never could, which is where to spend Monday.
                      A day inside the target takes the confirmed tone
                      instead: that is a state, not a rank. */}
                  <div className="bg-muted/60 h-2.5 w-full overflow-hidden rounded-full">
                    {row.minutes != null && (
                      <div
                        className="h-full rounded-full transition-[width] duration-(--dur-2)"
                        style={{
                          // The 2% floor is legitimate HERE and is not
                          // the floor `ChartBarRow` refuses. There it
                          // would paint a bar for R$ 0 — a real value
                          // that must read as nothing. Here every row
                          // that draws at all has a measured time in it,
                          // and the floor only keeps a genuinely fast
                          // day from vanishing next to a three-hour one.
                          width: `${Math.max(2, peakPercent(row.minutes, values))}%`,
                          // One hue in two weights, plus the one
                          // exception that means something. Same
                          // grammar as the funnel and the volume
                          // chart, so the three panels on this page
                          // read as one system rather than as three
                          // charts that happen to share a border.
                          background: within
                            ? 'var(--ok-500)'
                            : isSlowest
                              ? 'var(--chart-1)'
                              : 'color-mix(in oklab, var(--chart-1) 32%, transparent)',
                        }}
                      />
                    )}
                  </div>

                  <span className="flex shrink-0 items-baseline justify-end gap-2">
                    <span
                      className={cn(
                        'w-12 text-right text-xs font-semibold tabular-nums',
                        row.minutes == null
                          ? 'text-muted-foreground'
                          : 'text-foreground'
                      )}
                    >
                      {fmt(row.minutes)}
                    </span>
                    {/* TEXT, NOT PILLS. Seven filled chips down a
                        column is seven more objects on a panel whose
                        whole job is to be read in one glance, and the
                        colour on them was saying a third time what the
                        bar and the bold day label already say.
                        Fixed width so the seven make a column rather
                        than a ragged edge. The only one that keeps a
                        colour is a day inside the target, because that
                        is the state the panel exists to catch — and it
                        is a state, not a rank. */}
                    <span
                      className={cn(
                        'text-2xs w-20 text-right tabular-nums',
                        within
                          ? 'text-ok-ink font-semibold'
                          : 'text-muted-foreground'
                      )}
                    >
                      {row.minutes == null
                        ? t('noSamples')
                        : within
                          ? t('withinTarget')
                          : t('times', { times: times ?? 0 })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </PanelBody>
    </Panel>
  );
}

/** Seven rows, at the height the resolved ones render at. */
function ResponseSkeleton() {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-3"
        >
          <Skeleton className="ml-auto h-3 w-10" />
          <Skeleton className="h-2.5 rounded-full" />
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Minutes as something a person says out loud.
 *
 * `2.9h` was the old form and it is a spreadsheet's idea of time. Nobody
 * reports a response time as two point nine hours; the answer to "how
 * long did they wait" is two hours and fifty-four minutes, and at the
 * width of this column `2h54` fits.
 */
function fmt(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`;
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = Math.floor(mins / 60);
  const rest = Math.round(mins % 60);
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`;
}
