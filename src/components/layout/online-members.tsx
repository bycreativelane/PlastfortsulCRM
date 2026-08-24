'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { usePresence } from '@/hooks/use-presence';
import { avatarClass, avatarInitials } from '@/lib/avatar-color';
import { formatLastSeen, presenceLabel } from '@/lib/presence';
import { cn } from '@/lib/utils';
import {
  PresenceDot,
  PRESENCE_DOT_CLASS,
} from '@/components/presence/presence-dot';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

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
 * discs and a number is about the smallest thing that can answer "am I
 * alone in here right now", which for somebody deciding whether to park a
 * thread for a colleague or just answer it themselves is the question.
 *
 * THE PRESENCE IS THE ONE THE REST OF THE APP USES — `usePresence` over
 * `member_presence` (migration 024), the same source the assign menu's dots
 * and the auto-assign rotation read. A header that disagreed with the
 * dropdown about who is online would be worse than no header at all.
 */

/** How many faces before it becomes a number. */
const MAX_FACES = 3;

export function OnlineMembers({ className }: { className?: string }) {
  const t = useTranslations('Presence');
  const { accountId, user } = useAuth();
  const { getPresence, getRow, now } = usePresence();
  const [members, setMembers] = useState<
    Array<{ user_id: string; full_name: string }>
  >([]);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .eq('account_id', accountId);
      if (cancelled || !data) return;
      setMembers(
        (
          data as Array<{ user_id: string | null; full_name: string | null }>
        ).filter((m): m is { user_id: string; full_name: string } =>
          Boolean(m.user_id && m.full_name)
        )
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const present = useMemo(
    () =>
      members
        .map((m) => ({ ...m, status: getPresence(m.user_id) }))
        .filter((m) => m.status !== 'offline')
        // Yourself last: you know where you are, and putting your own face
        // first makes a room of one look like a room of one.
        .sort((a, b) => {
          if (a.user_id === user?.id) return 1;
          if (b.user_id === user?.id) return -1;
          return a.full_name.localeCompare(b.full_name);
        }),
    [members, getPresence, user?.id]
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
    <Popover>
      <PopoverTrigger
        aria-label={t('onlineCountAria', { count: present.length })}
        title={t('onlineCount', { count: present.length })}
        className={cn(
          'hover:bg-muted data-popup-open:bg-muted inline-flex h-9 items-center rounded-full px-1 transition-colors',
          className
        )}
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
            <span key={m.user_id} className="relative shrink-0">
              <span
                className={cn(
                  'text-avatar-ink ring-card text-3xs grid size-7 place-items-center rounded-full font-semibold ring-2',
                  avatarClass(m.full_name)
                )}
              >
                {avatarInitials(m.full_name)}
              </span>
              {/* Presence on the disc itself, which is what replaces the
                  word: green is here, amber is stepped away. Without it
                  the stack would say "these five exist", not "these five
                  are around" — and away-vs-online is the difference
                  between handing somebody a thread and waiting. */}
              <span
                className={cn(
                  'ring-card absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2',
                  PRESENCE_DOT_CLASS[m.status]
                )}
              />
            </span>
          ))}
          {overflow > 0 && (
            <span className="bg-muted text-secondary-foreground ring-card text-3xs grid size-7 shrink-0 place-items-center rounded-full font-semibold ring-2">
              +{overflow}
            </span>
          )}
        </span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-60 p-1.5">
        <p className="text-muted-foreground eyebrow px-2 pt-1 pb-1.5">
          {t('onlineTitle')}
        </p>
        <ul className="flex flex-col">
          {present.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
            >
              <span
                className={cn(
                  'text-avatar-ink text-2xs grid size-7 shrink-0 place-items-center rounded-full font-semibold',
                  avatarClass(m.full_name)
                )}
              >
                {avatarInitials(m.full_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-sm">
                  {m.full_name}
                  {m.user_id === user?.id ? t('you') : ''}
                </span>
                {/* "Ausente há 4 min" rather than a second dot: away is the
                    state where HOW LONG is the whole information. */}
                {m.status === 'away' && (
                  <span className="text-muted-foreground text-2xs block truncate">
                    {formatLastSeen(
                      getRow(m.user_id)?.last_seen_at ?? null,
                      now
                    )}
                  </span>
                )}
              </span>
              <PresenceDot
                status={m.status}
                label={presenceLabel(
                  m.status,
                  getRow(m.user_id)?.last_seen_at ?? null,
                  now,
                  t
                )}
                className="shrink-0"
              />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
