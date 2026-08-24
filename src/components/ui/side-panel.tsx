import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The pieces the contact panel is assembled from.
 *
 * That panel is a stack of small labelled sections — occurrences, active
 * automation, current opportunity, commercial history, quick actions, notes,
 * registration data. Each is a `SidePanelSection` with a `SidePanelLabel`, and
 * the contents are almost always either key/value rows or an action grid.
 */

function SidePanelSection({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="side-panel-section"
      className={cn(
        'border-border border-b px-4 py-3 last:border-b-0',
        className
      )}
      {...props}
    />
  );
}

function SidePanelLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="side-panel-label"
      className={cn(
        'text-muted-foreground text-3xs mb-2 flex items-center gap-1.5 font-bold tracking-wider uppercase [&>svg]:size-3',
        className
      )}
      {...props}
    />
  );
}

/**
 * One labelled fact. Key left, value right, value wins the space.
 *
 * The value truncates rather than wrapping: these rows are scanned, not read,
 * and a two-line value in a stack of fifteen destroys the rhythm that makes
 * them scannable in the first place. Pass `title` for the full text on hover.
 */
function KeyValue({
  className,
  label,
  children,
  ...props
}: React.ComponentProps<'div'> & { label: React.ReactNode }) {
  return (
    <div
      data-slot="key-value"
      className={cn(
        'flex items-center justify-between gap-2.5 py-1 text-xs',
        className
      )}
      {...props}
    >
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold">
        {children}
      </span>
    </div>
  );
}

/**
 * The quick actions, ONE PER ROW.
 *
 * This was two columns. In a 288px panel with its own padding that leaves
 * about 120px per cell, and the actions are verbs with objects — "Nova
 * oportunidade", "Registrar ocorrência" — so half of them wrapped onto two
 * lines while their neighbours sat on one. A grid of buttons where every
 * other label breaks is not a grid, it is six differently shaped buttons.
 *
 * One column costs vertical space in a panel that has it (it scrolls) and
 * buys a column of labels that all start in the same place and none of which
 * wrap. `full` on an action is therefore now a no-op kept for its call
 * sites — see below.
 */
function QuickActionGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="quick-action-grid"
      className={cn('grid grid-cols-1 gap-1.5', className)}
      {...props}
    />
  );
}

/**
 * One action in the panel's grid.
 *
 * Neutral by default. `ok` and `human` exist for the two that are not neutral
 * decisions — confirming an order, and scheduling a future purchase — and
 * `danger` for registering a loss. Everything else stays grey, or the grid
 * turns into the colour-noise this design system exists to avoid.
 */
const quickActionVariants = cva(
  'flex items-center gap-2 rounded-md border p-2 text-left text-xs font-semibold transition-colors [&>svg]:size-3.5 [&>svg]:shrink-0',
  {
    variants: {
      /* ONE BOX, FOUR INKS.
       *
       * The tones used to fill: `ok` and `human` painted the whole button in
       * their tint while `neutral` and `danger` stayed on the card. Six
       * actions in a column, two of them solid blocks of colour, and the
       * grid stopped reading as a set of equal choices — the amber one looked
       * like the answer rather than like an option.
       *
       * So the box is the same in all four and only the CONTENT carries the
       * tone: the label's ink and the icon. The fill comes back on hover,
       * where it is a response to the pointer rather than a permanent claim
       * on the eye. `danger` already worked this way; the others now match
       * it. */
      tone: {
        neutral:
          'border-border bg-card-2 text-secondary-foreground hover:bg-card hover:text-foreground [&>svg]:text-muted-foreground',
        ok: 'border-border bg-card-2 text-ok-ink hover:bg-ok-soft [&>svg]:text-ok',
        human:
          'border-border bg-card-2 text-human-ink hover:bg-human-soft [&>svg]:text-human',
        danger:
          'border-border bg-card-2 text-danger-ink hover:bg-danger-soft [&>svg]:text-danger',
      },
      /** No-op since the grid became one column; kept so call sites that
       *  say "this one spans the row" still compile and still read right. */
      full: { true: 'col-span-full', false: '' },
    },
    defaultVariants: { tone: 'neutral', full: false },
  }
);

function QuickAction({
  className,
  tone,
  full,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof quickActionVariants>) {
  return (
    <button
      type="button"
      data-slot="quick-action"
      className={cn(quickActionVariants({ tone, full }), className)}
      {...props}
    />
  );
}

export {
  SidePanelSection,
  SidePanelLabel,
  KeyValue,
  QuickActionGrid,
  QuickAction,
  quickActionVariants,
};
