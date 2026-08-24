'use client';

import { useMemo } from 'react';
import type { Deal, PipelineStage } from '@/types';
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Trophy,
  XCircle,
} from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Metric } from '@/components/ui/metric';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { useTranslations } from 'next-intl';

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  deals: Deal[];
}

/**
 * Weighted pipeline value: value × per-stage probability.
 * First stage ≈ 10%, stages interpolate up to 90% before the final stage,
 * final stage (Won) = 100%. Lost deals excluded.
 */
function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[]
): number {
  const n = sortedStages.length;
  if (n <= 1) return 1;
  const index = sortedStages.findIndex((s) => s.id === stage.id);
  if (index < 0) return 0;
  if (index === n - 1) return 1;
  const slots = n - 1;
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}

export function PipelineAnalytics({ stages, deals }: PipelineAnalyticsProps) {
  const t = useTranslations('Pipelines.analytics');
  const { defaultCurrency } = useAuth();
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages]
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== 'lost');
    const openDeals = active.filter((d) => d.status !== 'won');

    const totalCount = active.length;
    const totalValue = active.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const avgValue = totalCount > 0 ? totalValue / totalCount : 0;

    const stageById = new Map(sortedStages.map((s) => [s.id, s]));
    const weightedValue = openDeals.reduce((sum, d) => {
      const stage = stageById.get(d.stage_id);
      if (!stage) return sum;
      const prob = computeStageProbability(stage, sortedStages);
      return sum + Number(d.value || 0) * prob;
    }, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = (d: Deal) => {
      const ts = d.updated_at ?? d.created_at;
      return ts ? new Date(ts) >= monthStart : false;
    };
    const wonThisMonth = deals.filter(
      (d) => d.status === 'won' && thisMonth(d)
    ).length;
    const lostThisMonth = deals.filter(
      (d) => d.status === 'lost' && thisMonth(d)
    ).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonThisMonth,
      lostThisMonth,
    };
  }, [deals, sortedStages]);

  // One frame, one anatomy, one page. These six used to be `bg-muted/50`
  // tiles inside a `bg-card/60` bordered box — a box of boxes, sitting one
  // section below four bordered `Metric` cards that measure the same kind
  // of thing. Same card now, at `size="sm"`, because six across a row has
  // no space for a 24px currency value.
  //
  // The icons are all grey but one. Four of them were `text-primary`,
  // which in this system means "where you are / what you can press", and
  // none of these is either — an icon on a metric label identifies the
  // metric, it does not rank it. "Perdidas" keeps its red: lost is the one
  // thing on the row that the destructive token is actually for.
  // Literal keys, spelled out. `t(`${key}Tooltip`)` would read better and
  // would be invisible to `keys-exist.test.ts`, which is the one thing
  // standing between a renamed key and a panel that renders
  // `Pipelines.analytics.avgDealSizeTooltip` at users.
  const tiles = [
    {
      key: 'totalDeals',
      icon: <BarChart3 />,
      label: t('totalDeals'),
      value: String(stats.totalCount),
      hint: t('totalDealsTooltip'),
    },
    {
      key: 'pipelineValue',
      icon: <DollarSign />,
      label: t('pipelineValue'),
      value: formatCurrency(stats.totalValue, defaultCurrency),
      hint: t('pipelineValueTooltip'),
    },
    {
      key: 'avgDealSize',
      icon: <Target />,
      label: t('avgDealSize'),
      value: formatCurrency(stats.avgValue, defaultCurrency),
      hint: t('avgDealSizeTooltip'),
    },
    {
      key: 'weightedValue',
      icon: <TrendingUp />,
      label: t('weightedValue'),
      value: formatCurrency(stats.weightedValue, defaultCurrency),
      hint: t('weightedValueTooltip'),
    },
    {
      key: 'wonThisMonth',
      icon: <Trophy />,
      label: t('wonThisMonth'),
      value: String(stats.wonThisMonth),
      hint: t('wonThisMonthTooltip'),
    },
    {
      key: 'lostThisMonth',
      icon: <XCircle className="text-danger-ink" />,
      label: t('lostThisMonth'),
      value: String(stats.lostThisMonth),
      hint: t('lostThisMonthTooltip'),
    },
  ];

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <Metric
            key={tile.key}
            size="sm"
            icon={tile.icon}
            label={tile.label}
            value={tile.value}
            hint={tile.hint}
            hintLabel={t('howCalculated', { label: tile.label })}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
