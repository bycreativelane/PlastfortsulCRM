import * as React from 'react';
import { ArrowDown, ArrowUp, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * A number with a label and, when there is one, its movement.
 *
 * This is the report unit, not the dashboard unit — see `StatTile` for that.
 * The distinction matters: a tile counts things you can go and act on, and
 * links to them. A metric is a measurement of a period, and there is nothing
 * to click.
 *
 * The delta is the only coloured thing here, and it follows the doctrine
 * literally: green when the number moved the way you want, red when it moved
 * the other way. Which direction is "good" is NOT inferable from the sign —
 * time-to-close falling is good, revenue falling is not — so the caller states
 * it with `betterWhen`.
 */
interface MetricProps extends React.ComponentProps<'div'> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Percent change against the previous period. Omit when there is no basis. */
  delta?: number | null;
  /** Which direction counts as improvement. Defaults to up. */
  betterWhen?: 'up' | 'down';
  /** Shown instead of a delta — e.g. "aguardando histórico de etapa". */
  note?: React.ReactNode;
  /**
   * Two densities, one anatomy — the same split `StatePanel` makes.
   *
   * `md` is the period headline: four across a row, a 24px number you
   * read from across the desk. `sm` is the same card at six across,
   * where a 24px currency value would wrap inside a 200px column. It is
   * a size, not a different component: the border, the radius, the
   * label weight and the delta line are identical, which is the whole
   * point — /relatórios used to draw its top four with this file and its
   * next six with a private `Metric` declared inside
   * `pipeline-analytics.tsx`, in a different frame, at a different
   * weight, two sections apart on one page.
   */
  size?: 'sm' | 'md';
  /** Sits before the label. Grey, at label weight — it identifies, it does not rank. */
  icon?: React.ReactNode;
  /** "How is this calculated" — an info affordance at the end of the label row. */
  hint?: React.ReactNode;
  /** Accessible name for the hint trigger. Required when `hint` is set. */
  hintLabel?: string;
}

function Metric({
  className,
  label,
  value,
  delta,
  betterWhen = 'up',
  note,
  size = 'md',
  icon,
  hint,
  hintLabel,
  ...props
}: MetricProps) {
  const moved = typeof delta === 'number' && delta !== 0;
  const improving = moved && (betterWhen === 'up' ? delta > 0 : delta < 0);
  const sm = size === 'sm';

  return (
    <div
      data-slot="metric"
      className={cn(
        'border-border bg-card rounded-lg border',
        sm ? 'p-3' : 'p-4',
        className
      )}
      {...props}
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
        {icon ? (
          <span aria-hidden className="[&>svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        <span className="truncate">{label}</span>
        {hint ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={hintLabel}
                  className="text-muted-foreground hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 ml-auto rounded-sm outline-none focus-visible:ring-3"
                />
              }
            >
              <Info className="size-3" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-left">
              {hint}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div
        className={cn(
          'mt-1 leading-none tracking-tight tabular-nums',
          sm ? 'text-base font-semibold' : 'text-2xl font-bold'
        )}
      >
        {value}
      </div>
      {note ? (
        <div className="text-muted-foreground text-2xs mt-1.5">{note}</div>
      ) : delta === undefined || delta === null ? null : (
        <div
          className={cn(
            'text-2xs mt-1.5 flex items-center gap-1 font-semibold',
            !moved
              ? 'text-muted-foreground'
              : improving
                ? 'text-ok-ink'
                : 'text-danger-ink'
          )}
        >
          {moved ? (
            <>
              {delta > 0 ? (
                <ArrowUp className="size-3" />
              ) : (
                <ArrowDown className="size-3" />
              )}
              {delta > 0 ? '+' : ''}
              {delta}%
            </>
          ) : (
            'estável'
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A horizontal bar, for funnels and stage breakdowns.
 *
 * `tone="auto"` marks a stage an automation is driving — the same grey the rest
 * of the machine's work uses, so it reads as a footnote rather than a warning.
 */
function ProgressBar({
  className,
  value,
  tone = 'primary',
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  /** 0–100. Clamped, so a bad computation can't paint outside the track. */
  value: number;
  tone?: 'primary' | 'auto' | 'ok' | 'human' | 'danger';
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      data-slot="progress-bar"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('bg-muted h-1.5 overflow-hidden rounded-full', className)}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-full',
          tone === 'primary' && 'bg-primary',
          tone === 'auto' && 'bg-auto',
          tone === 'ok' && 'bg-ok',
          tone === 'human' && 'bg-human',
          tone === 'danger' && 'bg-danger'
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export { Metric, ProgressBar };
