import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A count with a caption — the unit the dashboard is built out of.
 *
 *   ┌──────────────────────────────┐
 *   │  ▣   4                       │   icon · number · label
 *   │      conversas não lidas      │
 *   └──────────────────────────────┘
 *
 * Every tile has the identical 1px frame on all four sides. What changes is the
 * icon's fill: amber when a person has to act, grey when it is the machine
 * reporting. That is the whole signal, and it is deliberately the only one —
 * a coloured border on top of a coloured icon is two channels saying one thing,
 * and it breaks the grid's alignment for nothing.
 *
 * Renders as a link when `href` is set, so a tile that names a queue can take
 * you to it. Otherwise it is a plain div and not focusable.
 */
/**
 * `h-full` is what keeps a ROW of these aligned.
 *
 * A grid stretches its items, so the cell is as tall as the tallest tile —
 * but the tile itself was only `w-full`, so its bordered box kept its own
 * content height and sat at the top of a taller cell. One label wrapping to
 * two lines was enough: that tile grew, and the other three drew their frames
 * short of the row, which reads as three misaligned boxes rather than as one
 * long label.
 */
const tileVariants = cva(
  'flex h-full w-full items-center gap-3 rounded-lg border border-border bg-card p-4 text-left',
  {
    variants: {
      interactive: {
        true: 'transition-shadow hover:shadow-sm',
        false: '',
      },
    },
    defaultVariants: { interactive: false },
  }
);

const tileIconVariants = cva(
  'grid size-9 shrink-0 place-items-center rounded-lg [&>svg]:size-4.5',
  {
    variants: {
      tone: {
        /** A person has to act. */
        human: 'bg-human-soft text-human-ink',
        /** The machine did something. Informational — never a task. */
        auto: 'bg-muted text-secondary-foreground',
        /** It failed. */
        danger: 'bg-danger-soft text-danger-ink',
        neutral: 'bg-muted text-secondary-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

interface StatTileProps
  extends
    Omit<React.ComponentProps<'div'>, 'title'>,
    VariantProps<typeof tileIconVariants> {
  icon: React.ReactNode;
  /** The number. Kept as a node so a tile can show "R$ 14.800" too. */
  value: React.ReactNode;
  /** What the number counts. Two short lines read better than one long one. */
  label: React.ReactNode;
}

function StatTile({
  className,
  icon,
  value,
  label,
  tone,
  ...props
}: StatTileProps) {
  return (
    <div
      data-slot="stat-tile"
      className={cn(tileVariants({ interactive: false }), className)}
      {...props}
    >
      <span className={tileIconVariants({ tone })}>{icon}</span>
      <div className="min-w-0">
        <div className="text-2xl leading-none font-bold tracking-tight tabular-nums">
          {value}
        </div>
        <div className="text-secondary-foreground mt-1 text-sm leading-tight font-medium">
          {label}
        </div>
      </div>
    </div>
  );
}

export { StatTile, tileVariants, tileIconVariants };
