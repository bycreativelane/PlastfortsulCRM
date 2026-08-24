'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useMemberNames } from '@/hooks/use-member-names';
import {
  hasUnreadTeamMessages,
  lastSeenTeamMessage,
  TEAM_SEEN_EVENT,
  type TeamMessage,
} from '@/lib/team/messages';
import { cn } from '@/lib/utils';

/**
 * The team room, from wherever you happen to be.
 *
 * The room itself lives in the inbox, which is the right home for it — it
 * is a conversation, and conversations are there. What that costs is
 * everywhere else: somebody on the Kanban or in Relatórios has no way of
 * knowing a colleague just asked them something, and a room you only
 * discover by navigating to it is a room that gets used twice.
 *
 * So the rail carries the last line and a dot. Not a second inbox — one
 * message, truncated, and a click that opens the real thing. The rail is
 * the only surface in this app that is on screen on every route, which is
 * exactly the property this needs and the reason it is here rather than in
 * the header.
 *
 * BELOW THE ROADMAP CARD, above the account tile. The tile is the rail's
 * floor — it holds "Sair" and it is where the eye goes to leave — so
 * nothing pushes it off the bottom of a short window.
 *
 * SILENT ONLY BEFORE MIGRATION 046. `team_messages` does not exist until it
 * is applied, and a card rendering "could not load" on every route would be
 * worse than no card.
 *
 * An EMPTY room still draws, which is the correction: hiding it until
 * somebody had written made the feature invisible on the day it shipped, and
 * nobody writes the first message in a place they cannot find.
 */
export function TeamRoomCard() {
  const t = useTranslations('Inbox.team');
  const { accountId } = useAuth();
  const [latest, setLatest] = useState<TeamMessage | null>(null);
  const [unread, setUnread] = useState(false);
  /** True once we know the table exists — see the fetch below. */
  const [available, setAvailable] = useState(false);
  const names = useMemberNames();

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    const apply = (row: TeamMessage | null) => {
      if (cancelled || !row) return;
      setLatest(row);
      setUnread(hasUnreadTeamMessages(row.created_at, lastSeenTeamMessage()));
    };

    (async () => {
      const { data, error } = await supabase
        .from('team_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);
      // Pre-046 the error IS "the table is not there", which is the only
      // reason to stay hidden — and not worth a console line on every page
      // load. No error means the room exists, with or without rows: two
      // different facts, and the card needs the first one.
      if (error || cancelled) return;
      setAvailable(true);
      apply((data?.[0] as TeamMessage) ?? null);
    })();

    const channel = supabase
      .channel('team-room-card')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'team_messages' },
        (payload) => apply(payload.new as TeamMessage)
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  // Re-derive when the room is read.
  //
  // `lastSeenTeamMessage()` is a localStorage read, which is not reactive:
  // the dot above was computed against the marker as it stood when the
  // newest message arrived, and opening the room moves that marker without
  // this component hearing about it. So the card kept a lit dot on every
  // route until a hard navigation remounted it, which is the "o ponto não
  // apaga" report. `markTeamRoomSeen` now announces itself — see
  // `TEAM_SEEN_EVENT`.
  useEffect(() => {
    const recheck = () =>
      setUnread(
        hasUnreadTeamMessages(latest?.created_at ?? null, lastSeenTeamMessage())
      );
    window.addEventListener(TEAM_SEEN_EVENT, recheck);
    return () => window.removeEventListener(TEAM_SEEN_EVENT, recheck);
  }, [latest]);

  // Hidden ONLY before migration 046, when the room does not exist. It used
  // to hide whenever the room was EMPTY too, and that was wrong in the way
  // that matters: a room nobody has written in yet is exactly the room that
  // needs to be visible, because nobody writes the first message in a place
  // they cannot find. On the day 046 lands every account has an empty room —
  // so the feature shipped invisible, and got reported as missing.
  if (!available) return null;

  const author = latest
    ? (names.get(latest.author_id) ?? t('unknownAuthor'))
    : null;

  return (
    <Link
      href="/inbox?team=1"
      // `data-nav-row` and NOT `data-nav-label`: the label attribute takes
      // the whole element away when the rail collapses, and this card is not
      // prose the way the roadmap card is — it is an icon with a dot on it,
      // which is exactly the thing a 62px rail is FOR. Hiding it meant the
      // one always-visible announcement that a colleague had written
      // disappeared for anyone who works with the rail collapsed. The text
      // column below carries `data-nav-label` and leaves on its own;
      // `data-nav-row` centres the disc in what is left.
      data-nav-row
      title={t('title')}
      className={cn(
        'group/team mb-3 flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
        unread
          ? 'bg-primary-soft hover:bg-primary-soft/70'
          : 'bg-muted hover:bg-muted/70'
      )}
    >
      <span
        className={cn(
          'relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
          unread ? 'bg-primary text-white' : 'bg-card text-primary'
        )}
      >
        <Users className="size-3" />
        {/* The collapsed rail's copy of the dot. The one beside the title
            goes with the text; this one rides the disc, so "there is
            something new" survives at 62px — the width where the card has
            no other way to say it. */}
        {unread && (
          <span
            data-nav-dot
            className="bg-primary ring-card absolute -top-0.5 -right-0.5 hidden size-2 rounded-full ring-2"
          />
        )}
      </span>

      <span data-nav-label className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-xs font-semibold',
              unread ? 'text-primary' : 'text-foreground'
            )}
          >
            {t('title')}
          </span>
          {/* A dot, not a count. The room is one conversation, and how many
              unread lines are in it is not a number anybody acts on
              differently — "there is something new" is the whole message. */}
          {unread && (
            <span className="bg-primary size-1.5 shrink-0 rounded-full" />
          )}
        </span>
        {/* One line, and it names who said it. In a room of four people
            "who" is most of what you need to decide whether to open it
            now. */}
        <span className="text-muted-foreground text-2xs mt-0.5 block truncate leading-snug">
          {latest && author ? (
            <>
              <span className="font-medium">{author}:</span> {latest.body}
            </>
          ) : (
            t('cardEmpty')
          )}
        </span>
      </span>
    </Link>
  );
}
