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
      className={cn(windowPillVariants({ state }), className)}
    >
      <Icon />
      {label}
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
 */
export const ownerChipVariants = cva(
  'inline-flex h-7 max-w-28 min-w-0 shrink items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors duration-(--dur-1) sm:max-w-44 [&>svg]:size-3.5 [&>svg]:shrink-0',
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

export function OwnerChipContent({ label }: { label: string }) {
  return (
    <>
      <UserPlus />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
}
