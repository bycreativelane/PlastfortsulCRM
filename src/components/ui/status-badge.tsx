import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A state badge, under the colour doctrine.
 *
 * Grey is the default and covers most of these. Only three variants carry
 * colour, and each means exactly one thing:
 *
 *   human  — a person has to act now. The only "come here" in the system.
 *   danger — it failed, was lost, or broke.
 *   ok     — confirmed. Used sparingly.
 *
 * `auto` is deliberately grey: automation is information, not attention. The
 * machine is identified by the lightning icon, never by colour — painting its
 * work made it compete visually with human work, which is backwards.
 *
 * Distinct from shadcn's `Badge`, which speaks in primary/secondary/outline —
 * terms about emphasis, not meaning. Reach for this one whenever the badge is
 * saying something about state.
 *
 * THE CHIP HEIGHT IS 20px, and it is 20px in `Badge` and `Tag` too.
 * This one used to be 22 — two pixels, which sounds like nothing until
 * a status badge and a tag sit in the same table cell and one of them
 * is taller than the other for no reason anybody could name. The eye
 * aligns a row by its tallest object, so a single 22px chip lifts the
 * whole row's rhythm off the 20px one beside it. `Tag size="sm"` is
 * the only other height, at 18px, for rows too dense to give 20.
 *
 * Shape is the second channel, deliberately: state is a PILL
 * (`rounded-full`), taxonomy is a rounded rectangle (`Tag`). Someone
 * who cannot separate the amber from the grey can still separate a
 * status from a label by its outline.
 */
const statusBadgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-secondary-foreground',
        auto: 'bg-auto-soft text-auto-ink',
        human: 'bg-human-soft text-human-ink',
        ok: 'bg-ok-soft text-ok-ink',
        danger: 'bg-danger-soft text-danger-ink',
      },
      // The dense one is a VARIANT, not a class the call site passes.
      // `deal-card.tsx` was writing `className="h-[18px] text-3xs"` onto
      // the badge to fit a card row — which works, and means the next
      // dense row invents its own number. Two heights, both named here.
      size: {
        default: 'h-5 px-2 text-2xs [&>svg]:size-3',
        sm: 'h-4.5 gap-1 px-1.5 text-3xs [&>svg]:size-2.5',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'default' },
  }
);

function StatusBadge({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof statusBadgeVariants>) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/**
 * The bare status dot, for when the badge would be too much — a connection
 * indicator, a priority marker in a dense list.
 *
 * IT MUST NEVER BE THE ONLY THING SAYING WHAT IT SAYS. Hue is the only
 * channel a dot has, and roughly 8% of men cannot separate the green
 * from the red in it. So the rule is that a dot sits next to words:
 * every call site in the app does (`<StatusDot variant="ok" />
 * {t('connected')}`), and that is what makes it legible rather than
 * decorative.
 *
 * `aria-hidden` is therefore the DEFAULT and the right one — the words
 * beside it already carry the meaning, and announcing "image" before
 * them is noise. It used to be unconditional, written before the props
 * spread, which meant a call site that did pass an `aria-label` got it
 * silently dropped onto a hidden element. Passing `label` now switches
 * the dot to `role="img"` with that label, for the one case where it
 * genuinely stands alone.
 */
const statusDotVariants = cva('size-2 shrink-0 rounded-full', {
  variants: {
    variant: {
      ok: 'bg-ok',
      warn: 'bg-human',
      danger: 'bg-danger',
      auto: 'bg-auto',
      idle: 'bg-muted-foreground',
    },
  },
  defaultVariants: { variant: 'idle' },
});

function StatusDot({
  className,
  variant,
  label,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof statusDotVariants> & {
    /** Only when the dot stands alone. See the note above. */
    label?: string;
  }) {
  return (
    <span
      data-slot="status-dot"
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true })}
      className={cn(statusDotVariants({ variant }), className)}
      {...props}
    />
  );
}

export { StatusBadge, StatusDot, statusBadgeVariants };
