import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The design system's card.
 *
 * Distinct from shadcn's `Card`, which this fork keeps for the surfaces it
 * already dresses. This one is the prototype's anatomy — a bordered head with
 * title, optional sub-line and right-aligned actions, over a body that can run
 * flush for tables and lists:
 *
 *   ┌─────────────────────────────────────────┐
 *   │ Title                    [actions]      │  PanelHeader
 *   │ Sub-line                                │
 *   ├─────────────────────────────────────────┤
 *   │ Body                                    │  PanelBody
 *   └─────────────────────────────────────────┘
 *
 * A real 1px border on all four sides, no shadow, no coloured left edge. The
 * accent bar was a second signalling channel competing with the first — in a
 * grid of tiles the urgency already comes from the icon, and the bar only broke
 * the alignment.
 */
function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel"
      className={cn(
        'border-border bg-card text-card-foreground rounded-lg border',
        className
      )}
      {...props}
    />
  );
}

function PanelHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        'border-border flex items-center gap-2.5 border-b px-4 py-3',
        className
      )}
      {...props}
    />
  );
}

function PanelTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-title"
      className={cn(
        'text-foreground text-sm font-semibold tracking-tight',
        className
      )}
      {...props}
    />
  );
}

function PanelSub({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-sub"
      className={cn('text-muted-foreground text-xs', className)}
      {...props}
    />
  );
}

/** Right-aligned slot in the header. Buttons go here, nothing else. */
function PanelActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel-actions"
      className={cn('ml-auto flex items-center gap-1.5', className)}
      {...props}
    />
  );
}

function PanelBody({
  className,
  flush = false,
  ...props
}: React.ComponentProps<'div'> & {
  /** Drop the padding — for tables and full-bleed lists. */
  flush?: boolean;
}) {
  return (
    <div
      data-slot="panel-body"
      className={cn(flush ? 'p-0' : 'p-4', className)}
      {...props}
    />
  );
}

export { Panel, PanelHeader, PanelTitle, PanelSub, PanelActions, PanelBody };
