import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { PageActionsSlot } from '@/components/layout/page-actions';

/**
 * The title block every page opens with.
 *
 * It exists because the app had six different answers to the same
 * question. Counting only the `<h1>`s: `text-2xl font-bold
 * tracking-tight` on eight pages, the same minus `tracking-tight` on
 * four, `text-2xl font-semibold` on Flows, and `text-xl font-semibold`
 * on Flow runs — with the sub-line under it sometimes `mt-1` and
 * sometimes `mt-0.5`. None of that was a decision; it was six people
 * typing the classes from memory. The differences are small enough
 * that you never catch one, and large enough that moving between
 * Contacts and Flows feels like moving between two products.
 *
 * The scale is the winning one, since two thirds of the app already
 * used it: 24px bold with the tracking pulled in — Inter needs it at
 * display sizes or the letters drift apart — over a 14px grey line.
 *
 * Actions DO live here — on the right of the title, in the same row,
 * separated from it by `justify-between` and nothing else. They used to
 * portal into the top bar, which put "Nova automação" a full window
 * away from the page it creates something on; page-actions.tsx has the
 * argument. A page still writes `<PageActions>` and never thinks about
 * where the slot is.
 *
 * `badge` is for something that qualifies the title itself (a Beta
 * chip, a status pill) — never a control.
 */
export function PageHeader({
  title,
  description,
  icon,
  badge,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Sits before the title at the title's own size. Used sparingly. */
  icon?: ReactNode;
  /** Chip after the title — qualifies what the page IS, not what it does. */
  badge?: ReactNode;
  className?: string;
  /** Anything that belongs under the description. Rare. */
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-6 gap-y-3',
        className
      )}
    >
      {/* `max-sm:basis-full` is what stops the actions from eating the
          title on a phone.
          The row is `flex-wrap`, but the title block was `min-w-0
          flex-1` and the actions `shrink-0`, so the title shrank to
          nothing instead of the actions wrapping. Measured at 390px with
          the Relatórios period control in the slot: the title block came
          out 53px wide, its description became seven lines of one word,
          and the header stood 208px tall before a single number. At
          360px it was 23px and 248px.
          Full basis below `sm` gives the title its own line and pushes
          the actions under it, right-aligned. Above `sm` nothing
          changes — the two share the row exactly as before. */}
      <div className="min-w-0 flex-1 max-sm:basis-full">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          {icon ? (
            <span className="text-primary grid shrink-0 place-items-center [&>svg]:size-6">
              {icon}
            </span>
          ) : null}
          <h1 className="text-foreground min-w-0 text-2xl font-bold tracking-tight">
            {title}
          </h1>
          {badge}
        </div>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {/* Whatever the page put in <PageActions>. Empty on most pages —
          `empty:hidden` so it can't add a gap of its own when it is.
          `mt-0.5` optically seats a 32px button against the cap-height
          of a 24px title rather than against its box.

          `flex-wrap` because `shrink-0` on a row of `whitespace-nowrap`
          buttons cannot get narrower than its labels: at 360px the
          Contatos page put "Importar" and "Novo contato" side by side
          in 328px of gutter-less width and cut the primary action in
          half. Wrapping stacks them instead, and `justify-end` keeps
          the stack on the title's own right edge rather than drifting
          to the left of it. */}
      <PageActionsSlot className="mt-0.5 flex shrink-0 flex-wrap items-center justify-end gap-2 empty:hidden" />
    </div>
  );
}
