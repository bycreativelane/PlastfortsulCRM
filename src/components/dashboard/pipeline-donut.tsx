'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { GitBranch } from 'lucide-react';
import { Cell, Pie, PieChart } from 'recharts';

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
import {
  CHART_HEIGHT,
  ChartSurface,
} from '@/components/charts/chart-primitives';
import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

interface PipelineDonutProps {
  data: PipelineDonutData | null;
  loading: boolean;
  /** Account default currency for the totals. */
  currency: string;
}

/** Ring geometry, in the pixels the chart is actually drawn at. */
const OUTER_R = 92;
const INNER_R = 64;

/**
 * Open deal value, split by stage.
 *
 * Three things changed here, and only one of them is decoration.
 *
 * 1. The segments now have gaps. The previous version's own comment
 *    promised them — "gaps between segments are implied by a thin
 *    slate-900 stroke between them" — and no such stroke was ever drawn.
 *    Five butted `strokeLinecap="butt"` arcs in five shades of the same
 *    ramp is one continuous ring with faint colour changes in it. A 2px
 *    `--card` stroke plus a padding angle is what makes five stages read
 *    as five things.
 *
 * 2. The ring answers when you point at it. It was a static picture:
 *    every number was in the list underneath, and the graphic beside it
 *    did nothing at all. Hovering a slice — or its row in the list —
 *    now dims the rest and swaps the centre to that stage.
 *
 * 3. The centre readout is HTML over the chart, not `<text>` inside it.
 *    In a scaled viewBox an SVG `text-lg` is 18px only at one container
 *    width; as an overlay it is 18px, which is what the scale says it is.
 *
 * The colours stay the stage's own `color` column. They are not chart
 * ink — they are the same swatches the deal cards and the board columns
 * carry, and a stage that is orange on the board and `--chart-3` here
 * would be two stages as far as the reader is concerned.
 */
export function PipelineDonut({ data, loading, currency }: PipelineDonutProps) {
  const t = useTranslations('Dashboard.pipelineDonut');
  const [activeId, setActiveId] = useState<string | null>(null);

  // Small slices would render as slivers that disappear into stroke
  // rounding, so each stage gets a floor share purely for drawing. The
  // labels and the list stay on the real totals — the ring is the shape
  // of the split, the numbers are the split.
  const slices = useMemo(() => {
    const stages = data?.stages ?? [];
    const totalRaw = data?.totalValue || 1;
    const floored = stages.map((s) => Math.max(s.totalValue / totalRaw, 0.02));
    const floorSum = floored.reduce((a, b) => a + b, 0) || 1;
    return stages.map((s, i) => ({ ...s, share: floored[i] / floorSum }));
  }, [data]);

  const active = activeId
    ? (slices.find((s) => s.id === activeId) ?? null)
    : null;

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
          // Measured against the ring it stands in for. It used to be
          // `h-56` over an `h-48` chart, so every load of /relatórios
          // resolved by dropping the page 32px.
          <Skeleton style={{ height: CHART_HEIGHT }} className="w-full" />
        ) : slices.length === 0 ? (
          <StatePanel
            icon={GitBranch}
            title={t('noOpenDeals')}
            description={t('noOpenDealsHint')}
          />
        ) : (
          <>
            <div className="relative">
              <ChartSurface>
                <PieChart
                  role="img"
                  aria-label={t('ariaLabel')}
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                >
                  <Pie
                    data={slices}
                    dataKey="share"
                    nameKey="name"
                    innerRadius={INNER_R}
                    outerRadius={OUTER_R}
                    // The gap the old comment described but never drew.
                    paddingAngle={2}
                    cornerRadius={3}
                    stroke="var(--card)"
                    strokeWidth={2}
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={false}
                    onMouseEnter={(_, i) => setActiveId(slices[i]?.id ?? null)}
                    onMouseLeave={() => setActiveId(null)}
                  >
                    {slices.map((s) => (
                      <Cell
                        key={s.id}
                        fill={s.color}
                        // Dim the others rather than lift the one. Lifting
                        // moves the ring; dimming leaves the shape of the
                        // split intact while you read one part of it.
                        opacity={!activeId || activeId === s.id ? 1 : 0.28}
                        className="transition-opacity"
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ChartSurface>

              {/* The centre. No Recharts tooltip on this chart on purpose —
                  a floating card over a ring covers the very slices you
                  are comparing, and the hole is already a readout with
                  nothing in it. */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="max-w-28">
                  <div className="text-muted-foreground text-2xs truncate">
                    {active ? active.name : t('total')}
                  </div>
                  <div className="text-foreground mt-0.5 text-lg leading-none font-semibold tabular-nums">
                    {formatCurrencyShort(
                      active ? active.totalValue : data.totalValue,
                      currency
                    )}
                  </div>
                  {active ? (
                    <div className="text-muted-foreground text-3xs mt-1 truncate">
                      {t('dealCount', { count: active.dealCount })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* The breakdown. Every column used to be `text-muted-foreground`
                — stage, count and value at one weight, which is a table
                with its hierarchy switched off. The name and the money are
                what you came for; the count is metadata. */}
            <ul className="border-border mt-4 space-y-px border-t pt-3">
              {slices.map((s) => (
                <li
                  key={s.id}
                  onMouseEnter={() => setActiveId(s.id)}
                  onMouseLeave={() => setActiveId(null)}
                  className={cn(
                    '-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                    activeId === s.id && 'bg-muted/60'
                  )}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  <span className="text-foreground flex-1 truncate">
                    {s.name}
                  </span>
                  <span className="text-muted-foreground text-2xs tabular-nums">
                    {t('dealCount', { count: s.dealCount })}
                  </span>
                  <span className="text-foreground w-20 text-right font-medium tabular-nums">
                    {formatCurrencyShort(s.totalValue, currency)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Screen readers get the split as numbers, since the ring is
                `role="img"` with one label and the list above is a hover
                affordance. */}
            <p className="sr-only">
              {slices
                .map(
                  (s) =>
                    `${s.name}: ${formatCurrencyShort(s.totalValue, currency)}, ${s.dealCount.toLocaleString(APP_LOCALE)}`
                )
                .join('. ')}
            </p>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
