'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The period's headline numbers, as one object.
 *
 * They were four separate bordered cards in a `grid gap-4`. Four cards
 * is what you build when each one is a thing you can act on — the way
 * `StatTile` works on the dashboard, where every tile links somewhere.
 * These do not link anywhere and are not four things: they are four
 * readings of one period, and drawing four boxes with four borders and
 * four shadows around them made the top of Relatórios the busiest part
 * of a page whose job is to be calm.
 *
 * One panel, divided. The dividers say "these belong together and are
 * read across", which is what a strip of period metrics is, and the page
 * loses three borders and three gaps without losing a single number.
 *
 * ------------------------------------------------------------------
 * IT STACKS BY DIVIDER, NOT BY CARD
 * ------------------------------------------------------------------
 *
 * Below `sm` the strip becomes rows separated by horizontal rules rather
 * than four stacked cards with gaps between them — which on a phone is
 * the difference between one screen and one and a half. `divide-y
 * sm:divide-y-0 sm:divide-x` is the whole mechanism, and it needs no
 * second layout.
 */

export interface MetricReading {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Percent change against the previous period. Omit when there is no basis. */
  delta?: number | null;
  /** Which direction counts as improvement. Defaults to up. */
  betterWhen?: 'up' | 'down';
  /** Shown instead of a delta. */
  note?: ReactNode;
  icon?: ReactNode;
}

export function MetricStrip({
  readings,
  loading,
  className,
}: {
  readings: MetricReading[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border bg-card divide-border grid divide-y overflow-hidden rounded-lg border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4',
        // The second row on a 2-up phone-to-tablet layout needs its own
        // top rule; `divide-x` alone leaves it floating.
        'sm:[&>*:nth-child(n+3)]:border-t sm:[&>*]:border-border',
        'sm:divide-x',
        className
      )}
    >
      {readings.map((reading) => (
        <div key={reading.key} className="min-w-0 p-4">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
            {reading.icon ? (
              <span aria-hidden className="[&>svg]:size-3.5">
                {reading.icon}
              </span>
            ) : null}
            <span className="truncate">{reading.label}</span>
          </div>

          {loading ? (
            <div className="bg-muted mt-2 h-7 w-24 animate-pulse rounded" />
          ) : (
            <div className="mt-1.5 text-2xl leading-none font-bold tracking-tight tabular-nums">
              {reading.value}
            </div>
          )}

          <MetricMovement
            delta={reading.delta}
            betterWhen={reading.betterWhen}
            note={reading.note}
            loading={loading}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The movement line, or the note that replaces it, or nothing.
 *
 * Always occupies its line even when there is nothing to say — four
 * readings where one has a delta and three do not would otherwise sit at
 * four different heights, which is the kind of misalignment that reads
 * as "assembled" without anybody being able to name it.
 */
function MetricMovement({
  delta,
  betterWhen = 'up',
  note,
  loading,
}: {
  delta?: number | null;
  betterWhen?: 'up' | 'down';
  note?: ReactNode;
  loading?: boolean;
}) {
  if (loading) {
    return <div className="bg-muted mt-2 h-3 w-16 animate-pulse rounded" />;
  }

  if (note) {
    return <div className="text-muted-foreground text-2xs mt-2">{note}</div>;
  }

  if (delta === undefined || delta === null) {
    // The reserved line. `&nbsp;` rather than a fixed height, so it
    // tracks the type scale if the scale ever moves.
    return <div className="text-2xs mt-2 opacity-0">&nbsp;</div>;
  }

  const moved = delta !== 0;
  const improving = moved && (betterWhen === 'up' ? delta > 0 : delta < 0);

  return (
    <div
      className={cn(
        'text-2xs mt-2 flex items-center gap-1 font-semibold',
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
        '—'
      )}
    </div>
  );
}
