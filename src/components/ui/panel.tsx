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
 *
 * ------------------------------------------------------------------
 * `rounded-xl`, AND WHY IT IS HERE RATHER THAN IN `--radius`
 * ------------------------------------------------------------------
 *
 * Softer corners are what separate a page of surfaces from a page of
 * boxes, and every dashboard worth borrowing from sits above 8px. The
 * obvious way to get there is to raise `--radius`, and that was tried:
 * it works on the panel and ruins the controls, because `rounded-lg` is
 * `var(--radius)` and `Input`, `Select`, `Textarea` and `Button` all
 * ask for the same token. 12px on a 400px panel is a soft surface; 12px
 * on a 32px field is a capsule.
 *
 * So the base stays at 8 for everything that is small, and the SURFACE
 * asks for one step up. `--radius-xl` is 1.4 × the base — 11.2px — and
 * it is derived, so a future change to the base still moves the panel
 * with everything else instead of stranding it.
 */
function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="panel"
      className={cn(
        'border-border bg-card text-card-foreground rounded-xl border',
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
