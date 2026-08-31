import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Clock, Lock, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionState } from '@/lib/inbox/session-window';

/**
 * The two chips in the conversation header.
 *
 * Both live here rather than inline in `message-thread.tsx` because both are
 * making the same argument in different registers: this header should be
 * quiet, except for the two things that can require a person to act right now
 * — the window about to close, and nobody owning the thread.
 */

const windowPillVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-3xs font-semibold whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0',
  {
    variants: {
      state: {
        // Plenty of time. The normal condition, so it says nothing.
        open: 'bg-muted text-muted-foreground',
        // Under two hours. Amber, because now it is a deadline.
        closing: 'bg-human-soft text-human-ink',
        // Past 24h — free-form replies will not deliver at all.
        expired: 'bg-danger-soft text-danger-ink',
        none: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { state: 'open' },
  }
);

/**
 * Meta's 24-hour window, as a chip in the header.
 *
 * Not in the composer, which is where it used to sit. Down there it was a
 * permanent band of chrome above the field, in the way for the 22 hours it had
 * nothing to say. Up here it costs 20px, and it is next to the stage and the
 * owner — the other two facts about this conversation you glance at rather
 * than read.
 */
export function WindowPill({
  state,
  label,
  title,
  className,
}: VariantProps<typeof windowPillVariants> & {
  state: SessionState;
  label: string;
  title?: string;
  className?: string;
}) {
  const Icon = state === 'expired' ? Lock : Clock;
  return (
    <span
      title={title}
      // `aria-label` and not the visible text: below `sm` the label is
      // hidden (see the span), so a screen reader would otherwise get a
      // lock glyph and nothing else.
      aria-label={label}
      className={cn(windowPillVariants({ state }), className)}
    >
      <Icon />
      {/* The words go, the colour and the glyph stay — PHONE ONLY.
          `sm:inline` and not a second component: this is the same chip
          in a narrower room. At 375px the header's fixed furniture
          (back + avatar + this + the owner chip + the overflow) added up
          to 344px against a 390px bar, and the contact's own name — the
          one thing the header exists to say — was left with 46px and
          rendered as "Marcos Al…". A clock or a padlock in the right
          colour carries the same fact in 20px. */}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

/**
 * Who owns this conversation — and the way to change it.
 *
 * Amber when nobody does. That is not decoration: in a shared mailbox an
 * unowned thread is the one state where the system genuinely does not know
 * who is handling it, and amber is reserved in this design for exactly that
 * — a person has to decide something. With an owner it drops to a neutral
 * outline and stops asking.
 *
 * Exported as classes rather than a component because it is used as a
 * dropdown trigger, and the trigger owns its own element.
 *
 * It shrinks, and it is the only thing in the right half of the header
 * that does. Everything beside it — refresh, contact details, the status
 * trigger — is a fixed icon or a two-word label; this one carries a
 * person's name, so it is the one that has to give. As `shrink-0` at
 * 11rem it was ~176px of unyielding width that pushed the contact's own
 * name to zero at 360px and then overflowed a header clipped by
 * `overflow-hidden`. `OwnerChipContent` already truncates inside.
 *
 * ------------------------------------------------------------------
 * AND ON A PHONE IT IS A DISC, NOT A CHIP
 * ------------------------------------------------------------------
 *
 * Truncating was not enough. At 375px `max-w-28` still spent 112px
 * stating the name of the person who ALREADY has the thread — a fact
 * the reader is not looking for — while the name of the person they are
 * TALKING TO, three inches to the left, was cut to "Marcos Al…". The
 * header was answering the wrong question with the better half of its
 * width.
 *
 * So below `sm` the chip collapses to a 28px round target: the
 * assignee's initials when somebody owns it, the amber `UserPlus` when
 * nobody does. The amber is what actually carries the meaning here —
 * "this thread has no owner, decide" reads from the colour alone at
 * arm's length, and always did. The name is one tap away in the menu
 * this chip already opens, and it is also on every row of the list
 * behind it. Above `sm` nothing changes.
 */
export const ownerChipVariants = cva(
  // `size-7 justify-center rounded-full` on the phone and a pill from
  // `sm` up. `px-0 sm:px-2.5` is the pair that matters: padding on a
  // fixed-width disc would push the initials off centre.
  'inline-flex size-7 shrink-0 items-center justify-center gap-1.5 rounded-full border px-0 text-xs font-semibold whitespace-nowrap transition-colors duration-(--dur-1) sm:size-auto sm:h-7 sm:max-w-44 sm:min-w-0 sm:shrink sm:px-2.5 [&>svg]:size-3.5 [&>svg]:shrink-0',
  {
    variants: {
      owned: {
        true: 'border-input bg-card text-secondary-foreground hover:bg-muted hover:text-foreground',
        false:
          'border-human-border bg-human-soft text-human-ink hover:bg-human-soft/70',
      },
    },
    defaultVariants: { owned: true },
  }
);

/**
 * `initials` is what the phone shows in place of the name; pass null
 * when the thread is unassigned and the `UserPlus` glyph carries it.
 */
export function OwnerChipContent({
  label,
  initials,
}: {
  label: string;
  initials?: string | null;
}) {
  return (
    <>
      {initials ? (
        <span aria-hidden className="text-2xs sm:hidden">
          {initials}
        </span>
      ) : null}
      <UserPlus className={cn(initials && 'hidden sm:block')} />
      <span className="hidden min-w-0 truncate sm:inline">{label}</span>
      {/* The full label survives for assistive tech at every width — the
          visible text above is `sm:inline` and the initials are
          `aria-hidden`, so without this the control announces as an
          unlabelled button on a phone. */}
      <span className="sr-only sm:hidden">{label}</span>
    </>
  );
}
