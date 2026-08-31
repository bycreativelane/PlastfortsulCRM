'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useMemberDirectory } from '@/hooks/use-member-directory';
import {
  countUnreadTeamMessages,
  lastSeenTeamMessage,
  TEAM_SEEN_EVENT,
  type TeamMessage,
} from '@/lib/team/messages';
import { loadTeamRooms, roomName, type TeamRoom } from '@/lib/team/rooms';
import { cn } from '@/lib/utils';
import { MemberAvatar } from '@/components/presence/member-avatar';

/**
 * The team room, from wherever you happen to be.
 *
 * The room itself lives in the inbox, which is the right home for it — it
 * is a conversation, and conversations are there. What that costs is
 * everywhere else: somebody on the Kanban or in Relatórios has no way of
 * knowing a colleague just asked them something, and a room you only
 * discover by navigating to it is a room that gets used twice.
 *
 * So the rail carries the tail of the conversation and a count. Not a
 * second inbox — three lines and a click that opens the real thing. The
 * rail is the only surface in this app that is on screen on every route,
 * which is exactly the property this needs and the reason it is here
 * rather than in the header.
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

/**
 * How many lines of history the card carries.
 *
 * It was one, and one line is a notification: somebody said something.
 * Three is the smallest number that shows a CONVERSATION — a question and
 * an answer still fit, and "Vitor asked, Ana answered, Vitor agreed" is a
 * thread you can decide not to open. That decision is the entire job of
 * this card.
 */
const LINES = 3;

/** How far back to look for them. See the room-picking note below. */
const LOOKBACK = 20;

export function TeamRoomCard() {
  const t = useTranslations('Inbox.team');
  const { accountId, user } = useAuth();
  /** Newest last, the way they are drawn. */
  const [recent, setRecent] = useState<TeamMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  /** True once we know the table exists — see the fetch below. */
  const [available, setAvailable] = useState(false);
  const directory = useMemberDirectory();

  const refreshUnread = useCallback(
    async (db = createClient()) => {
      if (!accountId) return;
      // Across every room, on purpose. The lines below show the room the
      // newest message is in; the badge answers "how much have I missed",
      // and missing four messages in a room this card is not currently
      // quoting still counts as missing them.
      setUnreadCount(
        await countUnreadTeamMessages(db, accountId, lastSeenTeamMessage())
      );
    },
    [accountId]
  );

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('team_messages')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(LOOKBACK);
      // Pre-046 the error IS "the table is not there", which is the only
      // reason to stay hidden — and not worth a console line on every page
      // load. No error means the room exists, with or without rows: two
      // different facts, and the card needs the first one.
      if (error || cancelled) return;
      setAvailable(true);
      setRecent(((data ?? []) as TeamMessage[]).slice().reverse());
      void refreshUnread(supabase);
    })();

    // Rooms, when the schema has them. `'missing-table'` is a pre-052
    // database, where every message is in the one room 046 built and the
    // heading below falls back to its name.
    void loadTeamRooms(supabase, accountId).then((result) => {
      if (cancelled || result === 'missing-table') return;
      setRooms(result);
    });

    const channel = supabase
      .channel('team-room-card')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as TeamMessage;
          setRecent((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [...prev, row].slice(-LOOKBACK)
          );
          // Counted rather than recounted: the round trip would be one
          // query per message received, on every route, for a number this
          // browser can derive exactly.
          const seen = lastSeenTeamMessage();
          if (!seen || row.created_at > seen) {
            setUnreadCount((n) => n + 1);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [accountId, refreshUnread]);

  // Re-derive when the room is read.
  //
  // `lastSeenTeamMessage()` is a localStorage read, which is not reactive:
  // the count above was computed against the marker as it stood when the
  // newest message arrived, and opening the room moves that marker without
  // this component hearing about it. So the card kept a lit badge on every
  // route until a hard navigation remounted it, which is the "o ponto não
  // apaga" report. `markTeamRoomSeen` now announces itself — see
  // `TEAM_SEEN_EVENT`.
  useEffect(() => {
    const recheck = () => void refreshUnread();
    window.addEventListener(TEAM_SEEN_EVENT, recheck);
    return () => window.removeEventListener(TEAM_SEEN_EVENT, recheck);
  }, [refreshUnread]);

  const latest = recent.length ? recent[recent.length - 1] : null;

  /**
   * The tail of ONE conversation, not of the account.
   *
   * With more than one room, the last three messages account-wide can be
   * three different conversations stacked — which is the opposite of what
   * three lines are for. So the newest message picks the room, and the
   * lines are that room's. `LOOKBACK` is what makes it likely three of
   * them are in the window; fewer is fine, and shows what there is.
   *
   * `?? null` on both sides so a pre-052 row (no column at all) compares
   * equal to another pre-052 row.
   */
  const lines = useMemo(() => {
    if (!latest) return [];
    const room = latest.room_id ?? null;
    return recent.filter((m) => (m.room_id ?? null) === room).slice(-LINES);
  }, [recent, latest]);

  const unread = unreadCount > 0;

  // Hidden ONLY before migration 046, when the room does not exist. It used
  // to hide whenever the room was EMPTY too, and that was wrong in the way
  // that matters: a room nobody has written in yet is exactly the room that
  // needs to be visible, because nobody writes the first message in a place
  // they cannot find. On the day 046 lands every account has an empty room —
  // so the feature shipped invisible, and got reported as missing.
  if (!available) return null;

  const room = latest?.room_id
    ? (rooms.find((r) => r.id === latest.room_id) ?? null)
    : (rooms.find((r) => r.is_default) ?? null);
  const heading = roomName(room, t('title'));

  const speaker = latest ? directory.get(latest.author_id) : null;
  /** You wrote the last line. Two things below turn on this. */
  const mine = !!latest && !!user && latest.author_id === user.id;

  /**
   * WHOSE FACE — and never your own.
   *
   * The disc used to be the same `Users` glyph on every account for every
   * message, which at 62px — the collapsed rail, where this disc is the
   * ENTIRE card — meant the one always-visible announcement that a
   * colleague had written could not say which colleague. A face answers
   * that before the text column has rendered, and the text column is the
   * half that disappears when the rail collapses.
   *
   * Then it did too much. The account tile sits a few pixels below this
   * one and is, always, a photograph of you — so the moment YOU wrote the
   * last line the rail ended in the same face twice, which reads as a
   * rendering fault rather than as two controls. Which is how it got
   * reported.
   *
   * The fix is not a smaller disc or a different shape. It is that "which
   * colleague" is a question with no content when the answer is you: you
   * know what you just wrote. So your own turn falls back to the room's
   * own glyph, and the face is kept for the case it was added for. The
   * two cards can now never show the same person — one of them is always
   * you and the other never is.
   */
  const face = !mine ? (speaker ?? null) : null;

  /**
   * The name, short.
   *
   * "Gabriel Spencer" spent most of a 200px card saying who, in full,
   * directly above a tile saying the same name in full again. First name
   * is how a room of four people refers to each other, and "Você" is
   * shorter than any of them.
   */
  const speakerLabel = (authorId: string): string => {
    if (user && authorId === user.id) return t('cardYou');
    return (
      directory.get(authorId)?.full_name?.trim().split(/\s+/)[0] ??
      t('unknownAuthor')
    );
  };

  /**
   * The lines, grouped into runs by author — ONE NAME, ABOVE.
   *
   * It was `Vitor: mensagem` inline, and inline is what breaks. The rail
   * gives this text about 150px: the name takes a third of it and the
   * sentence is truncated a third of the way in, so what the card shows
   * is who spoke and almost nothing of what they said. With three lines
   * it got worse, because the name was paid for again on every run.
   *
   * Above, once per run, it costs one short line and gives every message
   * line the full width. It is also what the room's own bubbles do — the
   * author's name sits over the first bubble of a turn, not inside it —
   * so the card and the room finally read the same way.
   */
  const runs: Array<{ authorId: string; messages: TeamMessage[] }> = [];
  for (const message of lines) {
    const last = runs[runs.length - 1];
    if (last && last.authorId === message.author_id) {
      last.messages.push(message);
    } else {
      runs.push({ authorId: message.author_id, messages: [message] });
    }
  }

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
      // The full sentence, for a card that can only afford a first name.
      title={
        latest && speaker
          ? `${heading} — ${speaker.full_name}: ${latest.body}`
          : heading
      }
      className={cn(
        'group/team mb-3 flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
        // NO FILL AT REST, which is the other half of the duplicate.
        //
        // It was `bg-muted`: the same fill, at nearly the same radius, as
        // the account tile a few pixels below. Two filled boxes of one
        // colour, each holding a disc over two lines of text — even with
        // different faces in them they read as one control drawn twice.
        //
        // What it takes instead is the grammar the nine navigation rows
        // above it already use, verbatim: transparent with a
        // `hover:bg-muted`, and `bg-primary-soft` for the state that wants
        // attention. This card IS a navigation row — it goes to
        // /inbox?team=1 — so looking like one is the consistent answer
        // rather than the quiet one, and the fill finally MEANS something:
        // it appears when there is unread, instead of being the card's
        // permanent costume.
        unread ? 'bg-primary-soft hover:bg-primary-soft/70' : 'hover:bg-muted'
      )}
    >
      <span className="relative mt-0.5 shrink-0">
        {face ? (
          <MemberAvatar
            name={face.full_name}
            avatarUrl={face.avatar_url}
            size="xs"
          />
        ) : (
          // The room itself — your own turn, and a room nobody has written
          // in yet. Tinted rather than filled at rest so the disc carries
          // the same visual weight as a face, and the column does not
          // flicker between two densities as messages arrive.
          <span
            className={cn(
              'grid size-6 place-items-center rounded-full',
              unread ? 'bg-primary text-white' : 'bg-primary-soft text-primary'
            )}
          >
            <Users className="size-3" />
          </span>
        )}
        {/* The collapsed rail's copy of the count. The badge beside the
            heading goes with the text; this one rides the disc, so "there
            is something new" survives at 62px — the width where the card
            has no other way to say it. A dot rather than the number: at
            62px there is no room for two digits, and the number is one
            click away. */}
        {unread && (
          <span
            data-nav-dot
            className="bg-primary ring-primary-soft absolute -top-0.5 -right-0.5 hidden size-2 rounded-full ring-2"
          />
        )}
      </span>

      <span data-nav-label className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-xs font-semibold',
              unread ? 'text-primary' : 'text-foreground'
            )}
          >
            {heading}
          </span>
          {/* A COUNT, not a dot — which reverses what this card used to
              say ("how many unread lines are in it is not a number
              anybody acts on differently"). That was a judgement about a
              room nobody had used yet. In use, one message and eleven
              messages are different situations: the first is a remark you
              can read later, the second is a conversation you have missed
              and are now behind on.

              Capped at 99+ because three digits change the card's width
              and nothing above 99 is a different decision. */}
          {unread && (
            <span className="bg-primary text-3xs grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 font-semibold text-white tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>

        {/* THE TAIL OF THE CONVERSATION, oldest at the top, the way the
            room itself reads. Each line truncates on its own rather than
            the block wrapping: three whole messages half-shown beats one
            message shown whole and two missing, because what the card is
            for is deciding whether to open the room. */}
        {runs.length > 0 ? (
          <span className="mt-1 block space-y-1">
            {runs.map((run) => (
              <span key={run.messages[0].id} className="block">
                {/* The name, on its own line, at the room's own eyebrow
                    weight — it is a label over the turn, not part of the
                    sentence. */}
                <span className="text-muted-foreground/80 text-3xs block truncate font-semibold">
                  {speakerLabel(run.authorId)}
                </span>
                {run.messages.map((message) => (
                  <span
                    key={message.id}
                    className="text-muted-foreground text-2xs block truncate leading-snug"
                  >
                    {message.body}
                  </span>
                ))}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground text-2xs mt-0.5 block truncate leading-snug">
            {t('cardEmpty')}
          </span>
        )}
      </span>
    </Link>
  );
}
