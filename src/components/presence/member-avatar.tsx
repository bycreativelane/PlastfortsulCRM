'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PRESENCE_DOT_CLASS } from '@/components/presence/presence-dot';
import { avatarInitials } from '@/lib/avatar-color';
import type { PresenceStatus } from '@/lib/presence';
import { cn } from '@/lib/utils';

/**
 * A colleague's face, wherever one is drawn.
 *
 * The app had four hand-rolled versions of this — the presence stack, the
 * team room, the room's rail card, the roster — and each one had picked a
 * different subset of three decisions: whether to try the photo at all,
 * whether to seed the initials disc from the name, and whether presence
 * rides the disc. The result was a member whose photo appeared in two places
 * out of five, and a green dot that meant "online" in the top bar and
 * nothing at all twelve pixels into the team room.
 *
 * `<Avatar>` already does the photo-with-initials-fallback part (it swaps to
 * the fallback on a 404, which a bare `<img>` does not). What this adds is
 * the size ladder and the dot, so "who is this and are they around" is one
 * component with one answer.
 */

/** The three sizes anything in this app actually asks for. */
const SIZE = {
  /** The deal card's footer, beside the due date. 20px. */
  '2xs': { avatar: 'size-5', text: 'text-3xs', dot: 'size-1.5' },
  /** The rail's card, where the whole disc is 24px. */
  xs: { avatar: 'size-6', text: 'text-3xs', dot: 'size-1.5' },
  /** Message bubbles, dense lists. */
  sm: { avatar: 'size-7', text: 'text-2xs', dot: 'size-2' },
  /** Rosters, the presence stack. */
  md: { avatar: 'size-8', text: 'text-xs', dot: 'size-2.5' },
  /** Panel headers. */
  lg: { avatar: 'size-9', text: 'text-sm', dot: 'size-2.5' },
} as const;

export type MemberAvatarSize = keyof typeof SIZE;

interface MemberAvatarProps {
  name: string | null | undefined;
  avatarUrl?: string | null;
  /**
   * Draws the dot when given. `offline` still draws — a grey dot is the
   * answer to "are they around", and omitting it turns an absent colleague
   * into an unanswered question.
   */
  status?: PresenceStatus;
  /** Accessible text for the dot; skipped when there is no dot. */
  statusLabel?: string;
  size?: MemberAvatarSize;
  /**
   * The colour the dot's ring blends into. Defaults to the card, which is
   * what sits behind an avatar nearly everywhere; the bubbles in the team
   * room and the rail's tinted tile pass their own.
   */
  ringClass?: string;
  className?: string;
}

export function MemberAvatar({
  name,
  avatarUrl,
  status,
  statusLabel,
  size = 'md',
  ringClass = 'ring-card',
  className,
}: MemberAvatarProps) {
  const scale = SIZE[size];
  const label = name ?? '';

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar className={cn(scale.avatar, 'after:hidden')}>
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={label} /> : null}
        <AvatarFallback
          seed={label}
          className={cn(scale.text, 'font-semibold')}
        >
          {avatarInitials(label)}
        </AvatarFallback>
      </Avatar>
      {status ? (
        <span
          role={statusLabel ? 'img' : undefined}
          aria-label={statusLabel}
          title={statusLabel}
          className={cn(
            'absolute -right-0.5 -bottom-0.5 rounded-full ring-2',
            scale.dot,
            ringClass,
            PRESENCE_DOT_CLASS[status]
          )}
        />
      ) : null}
    </span>
  );
}
