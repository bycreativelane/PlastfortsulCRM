'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { format, isSameDay } from 'date-fns';
import { ArrowLeft, Loader2, Send, Users, Wrench } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { avatarClass, avatarInitials } from '@/lib/avatar-color';
import { dateLocale } from '@/lib/i18n/dates';
import { cn } from '@/lib/utils';
import {
  loadTeamMessages,
  markTeamRoomSeen,
  sendTeamMessage,
  type TeamMessage,
} from '@/lib/team/messages';
import { StatePanel } from '@/components/ui/state-panel';
import { GatedButton } from '@/components/ui/gated-button';

/**
 * The room where the team talks to each other.
 *
 * DELIBERATELY NOT `MessageThread`. That component is 1500 lines of WhatsApp:
 * the 24-hour session window, template pickers, media upload, delivery ticks,
 * the signature toggle, assignment, the AI banner. None of it applies to two
 * colleagues typing at each other, and every one of those controls would be
 * a promise the room cannot keep — a "send template" button in a room with no
 * phone number at the other end.
 *
 * What it borrows instead is the SHAPE, so the room does not feel like a
 * different application: same doodle-free card surface, same day separators,
 * same bubble geometry, same composer pill. Somebody who can use the inbox
 * can use this without being told anything.
 *
 * The other side of that decision: nothing here can ever reach a customer.
 * There is no send path to Meta in this file, and `team_messages` has no
 * phone number on it. That is the property worth protecting — an internal
 * note that could be delivered by accident is worse than no internal notes.
 */
interface TeamChannelProps {
  /**
   * Leave the room. Phone only — from `md` up the conversation list is
   * always on screen beside this, so there is nothing to go back TO.
   */
  onBack?: () => void;
}

export function TeamChannel({ onBack }: TeamChannelProps) {
  const t = useTranslations('Inbox.team');
  const tThread = useTranslations('Inbox.messageThread');
  const { user, accountId } = useAuth();
  const canWrite = useCan('send-messages');
  const touch = useCoarsePointer();

  const [messages, setMessages] = useState<TeamMessage[] | null>(null);
  /** True when migration 046 has not been applied — the table is absent. */
  const [pending, setPending] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // ---- Load + realtime -----------------------------------------------

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const [rows, profileRes] = await Promise.all([
        loadTeamMessages(supabase, accountId),
        supabase.from('profiles').select('user_id, full_name'),
      ]);
      if (cancelled) return;

      if (rows === 'missing-table') {
        setPending(true);
        setMessages([]);
      } else {
        setMessages(rows);
      }
      if (profileRes.data) {
        setNames(
          new Map(
            (profileRes.data as Array<{ user_id: string; full_name: string }>)
              .filter((p) => p.user_id && p.full_name)
              .map((p) => [p.user_id, p.full_name])
          )
        );
      }
    })();

    // Its own channel, not the inbox's: this table has nothing to do with
    // `messages` or `conversations`, and sharing a channel would wake every
    // inbox subscriber for a note between two colleagues.
    const channel = supabase
      .channel(`team-room-${accountId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new as TeamMessage;
          setMessages((prev) => {
            if (!prev) return prev;
            // The sender already inserted it optimistically; realtime
            // delivers the same row back to them a moment later.
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  const newest = messages?.length
    ? messages[messages.length - 1].created_at
    : null;

  // Being in the room IS reading it. The list watches the same table and
  // re-derives its dot from this marker, so nothing has to be handed
  // upwards — see the `team-room-dot` subscription in conversation-list.
  useEffect(() => {
    if (!newest) return;
    markTeamRoomSeen(newest);
  }, [newest]);

  // Pin to the bottom, same as the customer thread.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ---- Send ------------------------------------------------------------

  // Hoisted out of the callback: the React Compiler cannot preserve
  // memoization across an optional chain it also has to track as a
  // dependency, and `user?.id` inside an async callback is exactly that
  // shape.
  const authorId = user?.id ?? null;

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending || !accountId || !authorId || pending) return;

    setSending(true);
    // Cleared before the round trip: the field belongs to the typist, and
    // holding their sentence hostage to the network is what makes a chat
    // feel slow.
    setText('');
    const el = textareaRef.current;
    if (el) el.style.height = 'auto';

    const { error } = await sendTeamMessage(createClient(), {
      accountId,
      authorId,
      body,
    });
    setSending(false);

    if (error) {
      // Give it back rather than losing it. `team_messages` arrives with
      // migration 046; until it is applied every send fails here, and the
      // one thing that must not happen is the message disappearing.
      setText(body);
    }
  }, [text, sending, accountId, authorId, pending]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !touch) {
        e.preventDefault();
        void send();
      }
    },
    [send, touch]
  );

  // ---- Render ----------------------------------------------------------

  const groups = useMemo(() => groupByDay(messages ?? []), [messages]);

  return (
    <div className="bg-card flex min-w-0 flex-1 flex-col">
      {/* Header — the room, and who is in it. No status, no owner, no
          session pill: none of those are questions you can ask about your
          own colleagues. */}
      <div className="border-border flex items-center gap-2.5 border-b px-3 py-3 sm:px-4">
        {/* The way out, phone only — the same control `MessageThread` draws,
            because this pane replaces that one and inherits its problem.
            Below `md` the conversation list is hidden while the room is
            open, so without this the only exit from the team room was a
            page reload. */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={tThread('backToConversations')}
            data-slot="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-1) md:hidden"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <span className="bg-primary-soft text-primary grid size-9 shrink-0 place-items-center rounded-full">
          <Users className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-foreground truncate text-sm font-semibold">
            {t('title')}
          </h2>
          <p className="text-muted-foreground truncate text-xs">
            {t('subtitle', { count: names.size })}
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages === null ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          // "Waiting on a migration" and "nobody has written yet" are
          // different screens. Drawing the second over the first tells
          // somebody the room works, and they type into it and watch the
          // message vanish — the same courtesy `occurrence-dialog` extends.
          <StatePanel
            icon={pending ? Wrench : Users}
            title={pending ? t('pendingTitle') : t('emptyTitle')}
            description={pending ? t('pendingBody') : t('emptyBody')}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {groups.map((group) => (
              <div key={group.day} className="flex flex-col gap-1">
                <div className="my-2 flex justify-center">
                  <span className="bg-muted text-muted-foreground text-3xs rounded-lg px-3 py-1 font-medium">
                    {group.day}
                  </span>
                </div>
                {group.messages.map((message, index) => {
                  const mine = message.author_id === authorId;
                  const previous = group.messages[index - 1];
                  // Same author twice in a row is one turn, so only the
                  // first bubble of a run carries the name and the disc.
                  const firstOfRun =
                    !previous || previous.author_id !== message.author_id;
                  const author =
                    names.get(message.author_id) ?? t('unknownAuthor');

                  return (
                    <div
                      key={message.id}
                      className={cn(
                        'flex items-end gap-2',
                        mine ? 'flex-row-reverse' : 'flex-row',
                        firstOfRun ? 'mt-2 first:mt-0' : 'mt-0.5'
                      )}
                    >
                      {/* The disc holds its space on the following bubbles
                          of a run, so the column does not jump. */}
                      <span
                        className={cn(
                          'text-avatar-ink text-2xs grid size-7 shrink-0 place-items-center rounded-full font-semibold',
                          firstOfRun ? avatarClass(author) : 'invisible'
                        )}
                      >
                        {avatarInitials(author)}
                      </span>

                      <div
                        className={cn(
                          'max-w-[75%] min-w-0 rounded-lg px-2.5 py-1.5 shadow-[var(--wa-shadow)]',
                          mine ? 'bg-wa-out' : 'bg-wa-in',
                          firstOfRun &&
                            (mine ? 'rounded-br-sm' : 'rounded-bl-sm')
                        )}
                      >
                        {/* Only on somebody else's first bubble. On your
                            own the answer is on the other side of the
                            screen, and repeating it is noise. */}
                        {firstOfRun && !mine && (
                          <span className="text-muted-foreground eyebrow block leading-tight">
                            {author}
                          </span>
                        )}
                        <p className="text-foreground text-sm break-words whitespace-pre-wrap">
                          {message.body}
                        </p>
                        <div className="mt-0.5 flex justify-end">
                          <span className="text-muted-foreground text-3xs">
                            {format(new Date(message.created_at), 'HH:mm')}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer — the pill, and nothing else. No clip, no microphone, no
          templates: this room sends text between colleagues. */}
      <div className="px-3 py-3 sm:px-4">
        <div className="border-border bg-card-2 flex items-end gap-1 rounded-3xl border px-1.5 py-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            }}
            onKeyDown={onKeyDown}
            disabled={!canWrite || pending}
            rows={1}
            placeholder={
              pending
                ? t('pendingTitle')
                : canWrite
                  ? t('placeholder')
                  : t('readOnlyPlaceholder')
            }
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            className={cn(
              'text-foreground placeholder-muted-foreground flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none',
              (!canWrite || pending) && 'cursor-not-allowed opacity-50'
            )}
          />
          <GatedButton
            size="sm"
            canAct={canWrite && !pending}
            gateReason="send messages"
            disabled={!text.trim() || sending}
            onClick={send}
            className="bg-primary hover:bg-primary-hover size-9 shrink-0 rounded-full p-0 disabled:opacity-40"
          >
            <Send className="size-4" />
          </GatedButton>
        </div>
      </div>
    </div>
  );
}

/** Messages under the day they were sent, same device the thread uses. */
function groupByDay(
  messages: TeamMessage[]
): Array<{ day: string; messages: TeamMessage[] }> {
  const groups: Array<{ day: string; date: Date; messages: TeamMessage[] }> =
    [];

  for (const message of messages) {
    const date = new Date(message.created_at);
    const last = groups[groups.length - 1];
    if (last && isSameDay(last.date, date)) {
      last.messages.push(message);
    } else {
      groups.push({
        day: format(date, 'PPP', { locale: dateLocale }),
        date,
        messages: [message],
      });
    }
  }

  return groups.map(({ day, messages: rows }) => ({ day, messages: rows }));
}
