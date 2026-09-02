'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { GitBranch } from 'lucide-react';

import type { PipelineDonutData } from '@/lib/dashboard/types';
import { formatCurrency, formatCurrencyShort } from '@/lib/currency';
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
import { ChartBarRow, peakPercent } from '@/components/charts/chart-primitives';
import { Skeleton } from './skeleton';

/**
 * The pipeline as a funnel — a silhouette, not a list of meters.
 *
 * ------------------------------------------------------------------
 * WHY IT IS STILL NOT A DONUT
 * ------------------------------------------------------------------
 *
 * A donut answers "what share of the total is each part". Pipeline
 * stages are not parts of a total — they are a SEQUENCE, and the two
 * things a person opens this panel to find out are both destroyed by
 * putting them on a ring:
 *
 *   · ORDER. Novo → Qualificado → Proposta → Fechado is the whole
 *     meaning of the data. A ring has no first and no last.
 *   · DROP-OFF. "Where do deals die?" is THE sales question, and it is
 *     the ratio between two ADJACENT stages. On a donut those are two
 *     arcs at two angles — the one comparison human vision is worst at.
 *
 * ------------------------------------------------------------------
 * THREE COLUMNS, AND ONE COLOUR
 * ------------------------------------------------------------------
 *
 * The name sits in a fixed gutter on the left, right-aligned against
 * the bars' shared origin; the bars own the middle; the money and the
 * share sit in a fixed gutter on the right. Nothing is written on top
 * of a colour chosen on a Kanban board, every bar starts at the same x,
 * and the only thing that varies down the middle column is length —
 * which is the channel doing the work.
 *
 * THE BARS ARE ONE HUE IN TWO WEIGHTS. The biggest stage is the accent
 * at full strength; every other is the same accent at a third of it.
 *
 * This is the third answer to a question this panel keeps asking, and
 * the first two were both wrong in the same direction. Eight database
 * colours at 8px read as a list of hairlines with no shape. The same
 * eight at full row height read as a rainbow slab — eight saturated
 * blocks touching, where the eye has to compare lengths across eight
 * different materials and nothing is emphasised because everything is.
 *
 * The stage's colour has not been taken away; it has been moved to
 * where it costs six pixels instead of a whole band. A dot beside the
 * name carries the identity it has on the board, the reader can still
 * match a row to a column, and the bars go back to meaning length.
 *
 * ------------------------------------------------------------------
 * AIR
 * ------------------------------------------------------------------
 *
 * A 12px bar in a 38px row. The bars no longer touch, and that is the
 * change, not a side effect of it: touching bands made the panel one
 * solid object you take in as a mass, and this panel is read one stage
 * at a time. Two thirds of every row is now background.
 *
 * ------------------------------------------------------------------
 * A STAGE WORTH NOTHING PINCHES THE SHAPE TO NOTHING
 * ------------------------------------------------------------------
 *
 * No minimum-width floor. A floor cannot tell "almost nothing" from
 * "nothing", so it paints a sliver for R$ 0 — the one value a chart of
 * money must never show. An empty stage draws no band at all, and the
 * silhouette necks to zero there, which is exactly the news.
 *
 * ------------------------------------------------------------------
 * ONE DROP-OFF, NOT SEVEN
 * ------------------------------------------------------------------
 *
 * The old layout printed "N% não avançaram" between every pair that
 * lost anybody — up to seven lines of small grey text threaded through
 * the bars, each one true and none of them the point. With the bands
 * touching there is nowhere to put them, and that turned out to be the
 * better answer: the worst step is named once, in the subtitle, with
 * both stages in it. Seven numbers you skim become one you read.
 *
 * Measured on COUNT, not on value: "sete viraram três" is a fact about
 * deals. One large deal landing in a late stage can push money UP
 * through a funnel that is losing everybody, and a drop-off computed on
 * value would report an improvement while the business bleeds.
 *
 * ------------------------------------------------------------------
 * ONE FUNNEL, TWO DENSITIES
 * ------------------------------------------------------------------
 *
 * `compact` — the dashboard's side card — keeps the rail-and-caption
 * form, via the shared `ChartBarRow`. It is ~300px wide and one of
 * three cards in a column: a three-column silhouette in it would give
 * the bands about 120px, where eight lengths are eight indistinguishable
 * stubs. That card is a glance at where the money sits; this panel is
 * the read.
 */

interface PipelineFunnelProps {
  data: PipelineDonutData | null;
  loading: boolean;
  currency: string;
  /**
   * `full` on a page that is only this panel; `compact` for the
   * dashboard card, where the same data has to sit in a column with two
   * others.
   */
  density?: 'full' | 'compact';
  /** The pipeline's total, in the header. The dashboard card wants it. */
  showTotal?: boolean;
  className?: string;
}

/**
 * Row height, and the bar inside it.
 *
 * 38 clears two lines of label (15 + 13 at `leading-tight`) with room
 * left over, and 12 is a bar you read as a length rather than as a
 * block. The ratio is the whole "lighter" brief: at 34/34 the panel was
 * a solid stack, at 38/12 it is a set of measurements with air around
 * them.
 */
const ROW = 38;
const BAR = 12;

export function PipelineFunnel({
  data,
  loading,
  currency,
  density = 'full',
  showTotal = false,
  className,
}: PipelineFunnelProps) {
  const t = useTranslations('Dashboard.pipelineDonut');
  const full = density === 'full';

  const rows = useMemo(() => {
    const stages = data?.stages ?? [];
    if (!stages.length) return [];

    const values = stages.map((s) => s.totalValue);
    const total = values.reduce((a, b) => a + b, 0);

    return stages.map((stage, i) => {
      const previous = i > 0 ? stages[i - 1] : null;
      const dropOff =
        previous && previous.dealCount > 0
          ? 1 - stage.dealCount / previous.dealCount
          : null;

      return {
        ...stage,
        // Share of the biggest stage, never of the total. Against the
        // total, eight stages draw eight stubs and length stops meaning
        // "how big is this" — it becomes a pie chart rendered as a worse
        // pie chart. The share of the total is printed instead, in the
        // right-hand gutter, where it costs no ink.
        percent: peakPercent(stage.totalValue, values),
        // The one stage drawn at full strength. `peakPercent` already
        // scales everything against this stage, so it is the bar that
        // reaches the right edge — emphasising it costs nothing and
        // stops the row of pale bars from having no anchor.
        isPeak:
          stage.totalValue > 0 && stage.totalValue === Math.max(...values),
        share: total > 0 ? Math.round((stage.totalValue / total) * 100) : 0,
        dropOff,
        previousName: previous?.name ?? null,
      };
    });
  }, [data]);

  /** The single worst step, for the subtitle. */
  const worstDrop = useMemo(() => {
    let worst: (typeof rows)[number] | null = null;
    for (const row of rows) {
      if (row.dropOff == null || row.dropOff <= 0) continue;
      if (!worst || row.dropOff > (worst.dropOff ?? 0)) worst = row;
    }
    return worst;
  }, [rows]);

  return (
    <Panel className={className}>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>{t('title')}</PanelTitle>
          {/* THE SUBTITLE ONLY PROMISES WHAT THE PANEL IS ABOUT TO SHOW.
              With one opportunity per stage — the shape of every new
              account — nothing has dropped off anywhere, and naming a
              worst step would send the reader looking for a number that
              does not exist. */}
          <PanelSub>
            {full && worstDrop?.previousName
              ? t('biggestDrop', {
                  percent: Math.round((worstDrop.dropOff ?? 0) * 100),
                  from: worstDrop.previousName,
                  to: worstDrop.name,
                })
              : t('funnelSubPlain')}
          </PanelSub>
        </div>
        {showTotal && data ? (
          <PanelActions>
            <span className="text-lg font-bold tracking-tight tabular-nums">
              {formatCurrency(data.totalValue, currency)}
            </span>
          </PanelActions>
        ) : null}
      </PanelHeader>
      <PanelBody>
        {loading ? (
          <FunnelSkeleton full={full} />
        ) : !rows.length ? (
          <StatePanel
            icon={GitBranch}
            title={t('noOpenDeals')}
            description={t('noOpenDealsHint')}
          />
        ) : full ? (
          <ol>
            {rows.map((row) => (
              <li
                key={row.id}
                // A fixed gutter, the elastic middle, a fixed gutter.
                // The middle column is the only one whose contents
                // change width — which is what lets eight right edges
                // read against each other instead of against eight
                // different starting points.
                className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-x-3"
                style={{ height: ROW }}
              >
                <div className="flex min-w-0 items-center justify-end gap-1.5">
                  <div className="min-w-0 text-right">
                    <div className="text-secondary-foreground truncate text-xs leading-tight font-medium">
                      {row.name}
                    </div>
                    <div className="text-muted-foreground text-3xs truncate leading-tight">
                      {t('dealCount', { count: row.dealCount })}
                    </div>
                  </div>
                  {/* THE STAGE'S OWN COLOUR, at six pixels.
                      It is the row's identity on the Kanban board and a
                      report that recolours it makes the reader
                      translate — so it stays. It just stops being the
                      material a length is measured in. */}
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                </div>

                <div className="min-w-0">
                  {/* No track behind the bar. A rail is what you draw
                      when a row is a meter reading a percentage of
                      something; these are lengths compared to each
                      other, and eight grey tracks would draw a box
                      around every one of them. */}
                  <div
                    className="rounded-full transition-[width] duration-(--dur-2)"
                    style={{
                      width: `${Math.max(0, Math.min(100, row.percent))}%`,
                      height: BAR,
                      background: row.isPeak
                        ? 'var(--chart-1)'
                        : 'color-mix(in oklab, var(--chart-1) 32%, transparent)',
                    }}
                    role="img"
                    aria-label={`${row.name}: ${formatCurrencyShort(
                      row.totalValue,
                      currency
                    )}, ${t('dealCount', { count: row.dealCount })}`}
                  />
                </div>

                <div className="flex shrink-0 items-baseline gap-2">
                  <span className="text-foreground text-xs font-semibold tabular-nums">
                    {formatCurrencyShort(row.totalValue, currency)}
                  </span>
                  {/* The share of the total — the question length
                      deliberately does not answer, since the bars are
                      scaled against the biggest stage. Plain muted text
                      now, not a filled pill: eight pills down a column
                      is eight more objects on a panel that was asked to
                      hold fewer. */}
                  <span className="text-muted-foreground text-2xs w-8 text-right tabular-nums">
                    {row.share > 0 ? `${row.share}%` : '—'}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          // The dashboard's side card. Same numbers, the rail form —
          // see the note at the top of the file for why the silhouette
          // does not survive being 300px wide.
          <ol className="space-y-2.5">
            {rows.map((row) => (
              <li key={row.id}>
                <ChartBarRow
                  density="compact"
                  // THE SAME GRAMMAR AS THE PANEL NEXT DOOR: the stage's
                  // colour is a dot on the label, and the rail is the
                  // one accent in two weights. These two funnels are one
                  // click apart, and the last time they disagreed about
                  // colour and scale nobody noticed for a release —
                  // which is the whole reason they share a component now.
                  label={
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: row.color }}
                      />
                      <span className="min-w-0 truncate">{row.name}</span>
                    </span>
                  }
                  color={
                    row.isPeak
                      ? 'var(--chart-1)'
                      : 'color-mix(in oklab, var(--chart-1) 32%, transparent)'
                  }
                  value={formatCurrencyShort(row.totalValue, currency)}
                  meta={row.dealCount.toLocaleString(APP_LOCALE)}
                  percent={row.percent}
                  chip={row.share > 0 ? `${row.share}%` : undefined}
                  ariaLabel={`${row.name}: ${formatCurrencyShort(
                    row.totalValue,
                    currency
                  )}, ${row.dealCount.toLocaleString(APP_LOCALE)}`}
                />
              </li>
            ))}
          </ol>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * The loading state, narrowing — so it has the shape of the thing it
 * stands in for rather than eight identical grey bars.
 */
function FunnelSkeleton({ full }: { full: boolean }) {
  if (!full) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-1.5" style={{ width: `${100 - i * 18}%` }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-x-3"
          style={{ height: ROW }}
        >
          <Skeleton className="ml-auto h-3.5 w-20" />
          <Skeleton
            className="rounded-full"
            style={{ width: `${100 - i * 16}%`, height: BAR }}
          />
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}
