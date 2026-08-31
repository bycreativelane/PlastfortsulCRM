'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { GitBranch, TrendingDown } from 'lucide-react';

import type { PipelineDonutData } from '@/lib/dashboard/types';
import { formatCurrencyShort } from '@/lib/currency';
import { APP_LOCALE } from '@/lib/i18n/locale';
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelSub,
  PanelTitle,
} from '@/components/ui/panel';
import { StatePanel } from '@/components/ui/state-panel';
import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

/**
 * The pipeline as a funnel, which is the shape it actually has.
 *
 * ------------------------------------------------------------------
 * WHY THIS REPLACES THE DONUT
 * ------------------------------------------------------------------
 *
 * A donut answers "what share of the total is each part". Pipeline
 * stages are not parts of a total — they are a SEQUENCE, and the two
 * things a person opens this panel to find out are both destroyed by
 * putting them on a ring:
 *
 *   · ORDER. Novo → Qualificado → Proposta → Fechado is the whole
 *     meaning of the data. A ring has no first and no last; the reader
 *     has to reconstruct the order from the legend, every time.
 *   · DROP-OFF. "Where do deals die?" is THE sales question, and it is
 *     the ratio between two ADJACENT stages. On a donut those two
 *     slices are two arcs at two angles — the one comparison human
 *     vision is worst at.
 *
 * A funnel puts the stages in order down the page, encodes value as a
 * length starting from a shared left edge (the comparison human vision
 * is best at), and prints the drop-off in the gap between each pair —
 * where the question is asked.
 *
 * ------------------------------------------------------------------
 * NO RECHARTS HERE, AND THAT IS NOT A REGRESSION
 * ------------------------------------------------------------------
 *
 * `chart-primitives.tsx` exists because three charts had three ideas of
 * what an axis and a tooltip were, and because hand-rolled SVG with a
 * fixed viewBox scales its own text — a 10px label rendering at 4px on a
 * phone. Neither applies to this panel: it has no axis, no gridline and
 * no tooltip to be inconsistent about, and it is made of divs, so every
 * label is real CSS pixels at every width.
 *
 * What it does borrow is the rule that matters: STAGE COLOUR COMES FROM
 * THE DATABASE. A stage's colour is its identity on the Kanban board,
 * and a report that recolours it makes the reader translate.
 */

interface PipelineFunnelProps {
  data: PipelineDonutData | null;
  loading: boolean;
  currency: string;
  className?: string;
}

export function PipelineFunnel({
  data,
  loading,
  currency,
  className,
}: PipelineFunnelProps) {
  const t = useTranslations('Dashboard.pipelineDonut');

  const rows = useMemo(() => {
    const stages = data?.stages ?? [];
    if (!stages.length) return [];

    // Width is scaled against the BIGGEST stage, not against the total.
    // Against the total, a healthy pipeline with six stages draws six
    // stubs — the bars would encode "share of everything", which is the
    // donut's question again, in a worse shape.
    const peak = Math.max(...stages.map((s) => s.totalValue), 0);

    return stages.map((stage, i) => {
      const previous = i > 0 ? stages[i - 1] : null;
      // Measured on COUNT, not on value: "sete viraram três" is a fact
      // about deals. Value moves for a reason that is not attrition —
      // one large deal in a late stage can make money go UP through a
      // funnel that is losing everybody, and the arrow would then claim
      // an improvement while the business is bleeding.
      const dropOff =
        previous && previous.dealCount > 0
          ? 1 - stage.dealCount / previous.dealCount
          : null;

      return {
        ...stage,
        // A floor so a real-but-tiny stage is still a visible mark
        // rather than an invisible one that reads as zero.
        width: peak > 0 ? Math.max(2, (stage.totalValue / peak) * 100) : 0,
        dropOff,
      };
    });
  }, [data]);

  return (
    <Panel className={className}>
      <PanelHeader>
        <PanelTitle>{t('title')}</PanelTitle>
        <PanelSub>{t('funnelSub')}</PanelSub>
      </PanelHeader>
      <PanelBody>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-28" />
                {/* Narrowing, so the loading state has the shape of the
                    thing it is standing in for. */}
                <Skeleton
                  className="h-7"
                  style={{ width: `${100 - i * 18}%` }}
                />
              </div>
            ))}
          </div>
        ) : !rows.length ? (
          <StatePanel
            icon={GitBranch}
            title={t('noOpenDeals')}
            description={t('noOpenDealsHint')}
          />
        ) : (
          <ol className="space-y-1">
            {rows.map((row, i) => (
              <li key={row.id}>
                {/* The drop-off sits BETWEEN the two bars it compares,
                    indented to the bar edge. Put it on the row instead
                    and it reads as a property of one stage rather than
                    as the step from one to the next. */}
                {row.dropOff != null && row.dropOff > 0 && (
                  <div className="text-muted-foreground flex items-center gap-1 py-1 pl-1 text-3xs">
                    <TrendingDown className="size-3" aria-hidden />
                    <span className="tabular-nums">
                      {t('dropOff', {
                        percent: Math.round(row.dropOff * 100),
                      })}
                    </span>
                  </div>
                )}

                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-secondary-foreground min-w-0 truncate text-xs font-medium">
                    {row.name}
                  </span>
                  {/* Money and count on one line, money first and heavier:
                      the count is metadata, the value is what was asked
                      for. Same hierarchy the old breakdown list settled
                      on — kept, because it was right. */}
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="text-foreground text-xs font-semibold tabular-nums">
                      {formatCurrencyShort(row.totalValue, currency)}
                    </span>
                    <span className="text-muted-foreground text-3xs tabular-nums">
                      {row.dealCount.toLocaleString(APP_LOCALE)}
                    </span>
                  </span>
                </div>

                {/* The bar. A track behind it so a short bar still reads
                    as "a little of something" rather than as a fragment
                    floating in space. */}
                <div className="bg-muted mt-1 h-7 w-full overflow-hidden rounded-md">
                  <div
                    className={cn(
                      'h-full rounded-md transition-[width] duration-(--dur-2)'
                    )}
                    style={{
                      width: `${row.width}%`,
                      backgroundColor: row.color,
                    }}
                    role="img"
                    aria-label={`${row.name}: ${formatCurrencyShort(
                      row.totalValue,
                      currency
                    )}, ${row.dealCount}`}
                  />
                </div>
                {i === rows.length - 1 ? null : <div className="h-1" />}
              </li>
            ))}
          </ol>
        )}
      </PanelBody>
    </Panel>
  );
}
