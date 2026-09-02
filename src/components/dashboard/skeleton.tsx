import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared skeleton primitive — a pulsing block sized to whatever
 * container it's dropped into. Used by every dashboard widget while
 * its data fetches.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

/**
 * The placeholder for a `<Metric>`, and it is measured against one.
 *
 * It used to be `rounded-xl border p-5` with `h-4 / mt-4 h-8 / mt-2
 * h-3` inside — 124px tall, against the 98px of the Metric it stands
 * in for, in a different radius. So every load of /relatórios drew a
 * grid of six boxes and then, on resolve, dropped the whole page 28px
 * and changed its corners. That is a layout shift the user reads as
 * the page "settling", and it is the single most expensive thing you
 * can do to a grid whose whole job is to look deliberate.
 *
 * Every number below is the Metric's own, in order:
 *
 *   p-4      16   the Metric's padding
 *   h-4      16   label — `text-xs`, line-box 16px
 *   mt-1      4   the Metric's gap to the value
 *   h-6      24   value — `text-2xl leading-none`
 *   mt-1.5    6   the Metric's gap to the delta line
 *   h-4      16   delta — `text-2xs`, line-box 16px
 *   p-4      16
 *   ————————————
 *            98   = Metric
 *
 * Change one there, change it here. There is no way to make a
 * skeleton self-measuring; the only defence is that the arithmetic is
 * written down.
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('border-border bg-card rounded-xl border p-4', className)}
    >
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-1 h-6 w-20" />
      <Skeleton className="mt-1.5 h-4 w-16" />
    </div>
  );
}
