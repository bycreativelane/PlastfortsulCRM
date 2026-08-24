import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The one frame for "there is nothing here", "you cannot be here" and
 * "this broke". Three sentences the app says constantly, and it had
 * eight different shapes for them.
 *
 * Counted before this existed: the empty list on Campanhas was a
 * dashed box with a 40px disc and a 14px title; on Automações a solid
 * card with no disc at all; on Fluxos a local `EmptyState` function
 * declared inside the page file; on Notificações a bare centred
 * paragraph; the charts used `dashboard/empty-state.tsx`; and the
 * "Acesso restrito" screen on Relatórios was a 12px disc with a
 * fourteen-pixel `<h1>` — the smallest page title in the product.
 * None of that was decided. It is what happens when the same idea is
 * retyped from memory eight times.
 *
 * Two densities, one geometry:
 *
 *   sm — sits INSIDE a panel that already has a border and a title.
 *        Never grows past the panel; the dashed frame is optional and
 *        only earns its place where the panel around it has none.
 *   md — owns the whole body of a page or a screen. Bigger disc,
 *        bigger measure, room for actions.
 *
 * The rhythm is proportional between the two rather than re-picked:
 * disc → title → body → actions is 12/4/16px at `sm` and 16/6/24px at
 * `md`. The measure is capped so the second line of the body never
 * runs longer than the first by more than a word — a centred paragraph
 * with a ragged bottom edge reads as a mistake even when nobody can
 * say why.
 *
 * Centred on both axes on purpose. This is the one place in the app
 * where symmetry is the message: nothing is competing for the space,
 * so nothing should look like it is.
 */
export function StatePanel({
  icon: Icon,
  title,
  description,
  actions,
  size = 'sm',
  framed = false,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or links. Laid out in one centred row that wraps. */
  actions?: ReactNode;
  size?: 'sm' | 'md';
  /** Dashed outline. Only for a slot that has no frame of its own. */
  framed?: boolean;
  className?: string;
}) {
  const md = size === 'md';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        md ? 'px-6 py-16' : 'min-h-40 px-4 py-6',
        framed && 'border-border bg-card/40 rounded-lg border border-dashed',
        className
      )}
    >
      {Icon ? (
        <div
          className={cn(
            'bg-muted text-muted-foreground grid shrink-0 place-items-center rounded-full',
            md ? 'size-12' : 'size-10'
          )}
        >
          <Icon className="size-5" />
        </div>
      ) : null}
      <p
        className={cn(
          'text-foreground font-semibold',
          Icon && (md ? 'mt-4' : 'mt-3'),
          md ? 'text-base tracking-tight' : 'text-sm'
        )}
      >
        {title}
      </p>
      {description ? (
        <p
          className={cn(
            'text-muted-foreground text-balance',
            md ? 'mt-1.5 max-w-sm text-sm' : 'mt-1 max-w-xs text-xs',
            'leading-relaxed'
          )}
        >
          {description}
        </p>
      ) : null}
      {actions ? (
        <div
          className={cn(
            'flex flex-wrap items-center justify-center gap-2',
            md ? 'mt-6' : 'mt-4'
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
