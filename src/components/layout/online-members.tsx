'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useMemberDirectory } from '@/hooks/use-member-directory';
import { usePresence } from '@/hooks/use-presence';
import { presenceLabel } from '@/lib/presence';
import { cn } from '@/lib/utils';
import { MemberAvatar } from '@/components/presence/member-avatar';

/**
 * Who else is here.
 *
 * A shared inbox is a room the team works in without seeing each other, and
 * the whole product acts on that fact — conversations get handed over,
 * threads get parked for somebody, the rotation only routes to people who
 * are online. Every one of those decisions is easier if you already know
 * who is at their desk, and until now the only place that showed it was the
 * assign dropdown, which you have to open a conversation to reach.
 *
 * The header is on every route and had a whole empty half. Three stacked
 * discs is about the smallest thing that can answer "am I alone in here
 * right now", which for somebody deciding whether to park a thread for a
 * colleague or just answer it themselves is the question.
 *
 * THE PRESENCE IS THE ONE THE REST OF THE APP USES — `usePresence` over
 * `member_presence` (migration 024), the same source the assign menu's dots
 * and the auto-assign rotation read. A header that disagreed with the
 * dropdown about who is online would be worse than no header at all.
 *
 * NO PANEL BEHIND IT ANY MORE, and that was asked for. Clicking the stack
 * used to open "Na equipe agora" — the same faces, the same dots, the same
 * order, plus the names. Which is a popover whose entire content is the
 * thing you were already looking at, in a product where the roster with the
 * roles and the last-seen times is two clicks away in Configurações ›
 * Equipe. What the faces owe the header is a glance, and a glance does not
 * need somewhere to click. The names did not go anywhere: each disc carries
 * its own `title`, so hovering one still says "Vitor — Ausente há 4 min".
 */

/** How many faces before it becomes a number. */
const MAX_FACES = 3;

export function OnlineMembers({ className }: { className?: string }) {
  const t = useTranslations('Presence');
  const { user } = useAuth();
  const { getPresence, getRow, now } = usePresence();
  const directory = useMemberDirectory();

  const present = useMemo(
    () =>
      [...directory.values()]
        .map((m) => ({ ...m, status: getPresence(m.user_id) }))
        .filter((m) => m.status !== 'offline')
        // Yourself last: you know where you are, and putting your own face
        // first makes a room of one look like a room of one.
        .sort((a, b) => {
          if (a.user_id === user?.id) return 1;
          if (b.user_id === user?.id) return -1;
          return a.full_name.localeCompare(b.full_name);
        }),
    [directory, getPresence, user?.id]
  );

  // Only the "nobody to show" case hides this now.
  //
  // It used to also hide on an account with fewer than two members, on the
  // argument that somebody working alone has nobody to be present with.
  // True, and beside the point: the control was ASKED FOR, and a member who
  // invites their first colleague today would find the roster missing until
  // that colleague accepts. A feature that decides on your behalf that you
  // do not need it is a feature you report as broken — which is how this
  // one was reported.
  if (present.length === 0) return null;

  const faces = present.slice(0, MAX_FACES);
  const overflow = present.length - faces.length;

  return (
    // A `<span>`, not a button. There is nothing behind it to open, and a
    // hover state on something that does not respond to a click is the
    // interface promising an action it does not have.
    <span
      aria-label={t('onlineCountAria', { count: present.length })}
      className={cn('inline-flex h-9 items-center px-1', className)}
    >
      {/* THE FACES ARE THE WHOLE CONTROL — no "3 online" beside them.
          The number was already in the picture: three discs ARE three
          people, and a count spelling that out is the label under a
          photograph of a chair reading "chair". What the word cost was
          the thing the discs are good at — a face is recognised before
          it is read, so "is Matheus around" was answered by the avatar
          and then repeated, more slowly, in text.

          Overlapped, so three faces cost the width of about two. */}
      <span className="flex items-center -space-x-2">
        {faces.map((m) => (
          <MemberAvatar
            key={m.user_id}
            name={m.full_name}
            avatarUrl={m.avatar_url}
            size="sm"
            // Presence on the disc itself, which is what replaces the
            // word: green is here, amber is stepped away. Without it the
            // stack would say "these five exist", not "these five are
            // around" — and away-vs-online is the difference between
            // handing somebody a thread and waiting.
            status={m.status}
            // The whole label on the disc, because the panel that used to
            // carry it is gone: name first, then the state and — for
            // somebody away — how long, which is the part that decides
            // whether you wait for them.
            statusLabel={`${m.full_name}${m.user_id === user?.id ? t('you') : ''} — ${presenceLabel(
              m.status,
              getRow(m.user_id)?.last_seen_at ?? null,
              now,
              t
            )}`}
            className="ring-card rounded-full ring-2"
          />
        ))}
        {overflow > 0 && (
          <span
            title={present
              .slice(MAX_FACES)
              .map((m) => m.full_name)
              .join(', ')}
            className="bg-muted text-secondary-foreground ring-card text-3xs grid size-7 shrink-0 place-items-center rounded-full font-semibold ring-2"
          >
            +{overflow}
          </span>
        )}
      </span>
    </span>
  );
}
