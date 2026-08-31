'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { format, isSameDay } from 'date-fns';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Loader2,
  MoreVertical,
  Pencil,
  Send,
  Trash2,
  Users,
  Wrench,
  X,
} from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan, useCapability } from '@/hooks/use-can';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { useMemberDirectory } from '@/hooks/use-member-directory';
import { usePresence } from '@/hooks/use-presence';
import { dateLocale } from '@/lib/i18n/dates';
import { presenceLabel } from '@/lib/presence';
import { cn } from '@/lib/utils';
import {
  deleteTeamMessage,
  editTeamMessage,
  loadTeamMessages,
  markTeamRoomSeen,
  sendTeamMessage,
  type TeamMessage,
} from '@/lib/team/messages';
import {
  defaultRoom,
  loadTeamRooms,
  roomName,
  type TeamRoom,
} from '@/lib/team/rooms';
import { MemberAvatar } from '@/components/presence/member-avatar';
import { StatePanel } from '@/components/ui/state-panel';
import { GatedButton } from '@/components/ui/gated-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

/** Ceiling for a textarea's own growth, in pixels. */
const COMPOSER_MAX_HEIGHT = 140;

/**
 * Grow a textarea to its content and stop.
 *
 * Hoisted out of the handler that had it inline, because the edit box below
 * needs the same behaviour and a second copy is a second ceiling to keep in
 * step. One function, one number.
 */
function autosize(el: HTMLTextAreaElement | null, max = COMPOSER_MAX_HEIGHT) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
}

export function TeamChannel({ onBack }: TeamChannelProps) {
  const t = useTranslations('Inbox.team');
  const { confirm } = useConfirm();
  const tThread = useTranslations('Inbox.messageThread');
  const tPresence = useTranslations('Presence');
  const { user, accountId } = useAuth();
  // The room's own capability rather than the global "can send
  // messages": writing to a colleague and writing to a customer are two
  // different permissions, and an account can now separate them from
  // Configurações › Acesso. `agent` is still the default answer, which
  // is what `useCan('send-messages')` said here before.
  const canWrite = useCapability('team-room.write');
  /** Admins and owners may clear somebody else's message — see 046's policy. */
  const canModerate = useCan('edit-settings');
  const touch = useCoarsePointer();

  const [messages, setMessages] = useState<TeamMessage[] | null>(null);
  /** True when migration 046 has not been applied — the table is absent. */
  const [pending, setPending] = useState(false);
  /**
   * The rooms, and the one being read.
   *
   * Empty on a pre-052 database, where `loadTeamRooms` answers
   * 'missing-table' — and then `room` stays null, which every read below
   * treats as "the one room 046 built". That is the same thing the NULL
   * `room_id` on those rows means, so nothing special-cases it.
   */
  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  /** The message being rewritten, and the text it currently holds. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Names AND photos, from the one hook every other surface uses. It used to
  // be a local `select('user_id, full_name')` right here, which is why a
  // member who uploaded a photo saw it in Configurações and nowhere else.
  const directory = useMemberDirectory();
  // Presence rides the disc in here too. The room is where you ask a
  // colleague something and then decide whether to wait for the answer, and
  // that decision is exactly "are they at their desk".
  const { getPresence, getRow, now } = usePresence();

  // ---- Load + realtime -----------------------------------------------

  // The rooms, once per account. Separate from the message load below
  // because that one re-runs every time you switch room and this one
  // never has to.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void loadTeamRooms(createClient(), accountId).then((result) => {
      if (cancelled || result === 'missing-table') return;
      setRooms(result);
      setRoomId((current) => current ?? defaultRoom(result)?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const room = roomId ? (rooms.find((r) => r.id === roomId) ?? null) : null;
  // Hoisted so the load effect below depends on two primitives rather than
  // on an object identity that changes on every render.
  const roomIsDefault = room?.is_default ?? true;

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setMessages(null);
      const rows = await loadTeamMessages(supabase, accountId, {
        id: roomId,
        isDefault: roomIsDefault,
      });
      if (cancelled) return;

      if (rows === 'missing-table') {
        setPending(true);
        setMessages([]);
      } else {
        setMessages(rows);
      }
    })();

    // Its own channel, not the inbox's: this table has nothing to do with
    // `messages` or `conversations`, and sharing a channel would wake every
    // inbox subscriber for a note between two colleagues.
    //
    // All three events, not just INSERT. A room where a colleague's
    // correction only lands after a page reload is a room that shows two
    // people different histories — and with edit and delete now wired up
    // that stopped being hypothetical.
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
          // The subscription is per ACCOUNT — Postgres filters take one
          // column, and `account_id` is the one that keeps another
          // tenant's traffic off this socket. Which room it belongs to is
          // decided here, where both halves of "the default room" (a NULL
          // and the row's own id) are known.
          if (!belongsHere(row)) return;
          setMessages((prev) => {
            if (!prev) return prev;
            // The sender already inserted it optimistically; realtime
            // delivers the same row back to them a moment later.
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'team_messages',
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new as TeamMessage;
          if (!belongsHere(row)) return;
          setMessages((prev) =>
            prev ? prev.map((m) => (m.id === row.id ? row : m)) : prev
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'team_messages',
          // No `filter` here, unlike the two above. The "old" row Postgres
          // ships for a delete carries only the replica identity — the
          // primary key — so a filter on `account_id` matches nothing and
          // every delete would arrive invisible. Dropping an id this client
          // does not hold is a no-op, so the wider subscription is safe.
        },
        (payload) => {
          const gone = (payload.old as { id?: string })?.id;
          if (!gone) return;
          setMessages((prev) =>
            prev ? prev.filter((m) => m.id !== gone) : prev
          );
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };

    /** Is this row in the room currently on screen? */
    function belongsHere(row: TeamMessage): boolean {
      const rowRoom = row.room_id ?? null;
      if (rowRoom === null) return roomIsDefault;
      return rowRoom === roomId;
    }
  }, [accountId, roomId, roomIsDefault]);

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
      roomId,
    });
    setSending(false);

    if (error) {
      // Give it back rather than losing it. `team_messages` arrives with
      // migration 046; until it is applied every send fails here, and the
      // one thing that must not happen is the message disappearing.
      setText(body);
    }
  }, [text, sending, accountId, authorId, pending, roomId]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !touch) {
        e.preventDefault();
        void send();
      }
    },
    [send, touch]
  );

  // ---- Edit and delete -------------------------------------------------

  const startEdit = useCallback((message: TeamMessage) => {
    setEditingId(message.id);
    setEditText(message.body);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  // The edit box takes the caret as soon as it exists, and takes it at the
  // END. Focusing without moving it drops you before the first character,
  // which for "fix the last word" is the wrong end of the sentence.
  useEffect(() => {
    if (!editingId) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autosize(el);
  }, [editingId]);

  const commitEdit = useCallback(async () => {
    if (!editingId) return;
    const body = editText.trim();
    const original = messages?.find((m) => m.id === editingId) ?? null;

    // Nothing changed, or everything was erased — neither is an edit. An
    // empty body would fail the table's own CHECK anyway; catching it here
    // means the room does not flash an error over a keystroke.
    if (!body || body === original?.body) {
      cancelEdit();
      return;
    }

    // Optimistic, and the stamp goes on with it: the mark is the price of
    // the edit, so it must not appear a round trip after the new text.
    const stamp = new Date().toISOString();
    setMessages((prev) =>
      prev
        ? prev.map((m) =>
            m.id === editingId ? { ...m, body, edited_at: stamp } : m
          )
        : prev
    );
    cancelEdit();

    const { error } = await editTeamMessage(createClient(), {
      id: editingId,
      body,
    });
    // Put the original back if the database refused. Realtime would correct
    // this eventually, but only if somebody else happens to write.
    if (error && original) {
      setMessages((prev) =>
        prev ? prev.map((m) => (m.id === original.id ? original : m)) : prev
      );
    }
  }, [editingId, editText, messages, cancelEdit]);

  const onEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !touch) {
        e.preventDefault();
        void commitEdit();
      }
    },
    [cancelEdit, commitEdit, touch]
  );

  const remove = useCallback(
    async (message: TeamMessage) => {
      if (
        !(await confirm({
          title: t('deleteConfirm'),
          confirmLabel: t('deleteAction'),
          destructive: true,
        }))
      ) {
        return;
      }
      // Optimistic here too, with the same restore-on-refusal as the edit.
      setMessages((prev) =>
        prev ? prev.filter((m) => m.id !== message.id) : prev
      );
      const { error } = await deleteTeamMessage(createClient(), message.id);
      if (error) {
        setMessages((prev) =>
          prev
            ? [...prev, message].sort((a, b) =>
                a.created_at.localeCompare(b.created_at)
              )
            : prev
        );
      }
    },
    [confirm, t]
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

        {/* ONE ROOM DRAWS A HEADING; TWO DRAW A CONTROL.
            An account that never opens Configurações › Salas has exactly
            the header it had before 052 — a title and a subtitle, no
            affordance, nothing to decide. The switcher appears the moment
            there is somewhere to switch TO, which is the only moment it
            says anything. */}
        {rooms.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="hover:bg-muted data-popup-open:bg-muted -mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors">
              <span className="min-w-0">
                <span className="text-foreground flex items-center gap-1 truncate text-sm font-semibold">
                  {roomName(room, t('title'))}
                  <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {room?.description || t('subtitle', { count: directory.size })}
                </span>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-72 min-w-56">
              {rooms.map((r) => (
                <DropdownMenuItem
                  key={r.id}
                  onClick={() => setRoomId(r.id)}
                  className={cn(r.id === roomId && 'bg-accent')}
                >
                  <Users className="size-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {roomName(r, t('title'))}
                    </span>
                    {/* The description is the reason the room exists, and
                        the switcher is the one place somebody is choosing
                        between rooms rather than already in one. */}
                    {r.description ? (
                      <span className="text-muted-foreground text-2xs block truncate">
                        {r.description}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="min-w-0">
            <h2 className="text-foreground truncate text-sm font-semibold">
              {roomName(room, t('title'))}
            </h2>
            <p className="text-muted-foreground truncate text-xs">
              {room?.description || t('subtitle', { count: directory.size })}
            </p>
          </div>
        )}
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
                  const member = directory.get(message.author_id);
                  const author = member?.full_name ?? t('unknownAuthor');
                  const status = getPresence(message.author_id);
                  const editing = editingId === message.id;

                  return (
                    <div
                      key={message.id}
                      className={cn(
                        'group/msg flex items-end gap-2',
                        mine ? 'flex-row-reverse' : 'flex-row',
                        firstOfRun ? 'mt-2 first:mt-0' : 'mt-0.5'
                      )}
                    >
                      {/* The disc holds its space on the following bubbles
                          of a run, so the column does not jump. */}
                      {firstOfRun ? (
                        <MemberAvatar
                          name={author}
                          avatarUrl={member?.avatar_url}
                          size="sm"
                          status={status}
                          statusLabel={`${author} — ${presenceLabel(
                            status,
                            getRow(message.author_id)?.last_seen_at ?? null,
                            now,
                            tPresence
                          )}`}
                        />
                      ) : (
                        <span aria-hidden className="size-7 shrink-0" />
                      )}

                      <div
                        className={cn(
                          'max-w-[85%] min-w-0 rounded-lg px-2.5 py-1.5 shadow-[var(--wa-shadow)] sm:max-w-[75%]',
                          mine ? 'bg-wa-out' : 'bg-wa-in',
                          firstOfRun &&
                            (mine ? 'rounded-br-sm' : 'rounded-bl-sm')
                        )}
                      >
                        {/* Only on somebody else's first bubble. On your
                            own the answer is on the other side of the
                            screen, and repeating it is noise.

                            NOT `eyebrow` any more. That utility is 10px,
                            weight 700, uppercase and letter-spaced — a
                            treatment built for section headings, and in a
                            bubble it made "VITOR" the loudest thing in a
                            row whose content was one word. The name is a
                            caption on the message, not a headline over it:
                            same size, half the weight, sentence case, and
                            the eye lands on the sentence instead. */}
                        {firstOfRun && !mine && (
                          <span className="text-muted-foreground text-3xs block leading-tight font-medium">
                            {author}
                          </span>
                        )}

                        {editing ? (
                          // The bubble becomes the editor rather than
                          // opening a dialog over it. What you are changing
                          // stays exactly where it was, at the width it
                          // will keep — a modal would move the sentence to
                          // the middle of the screen and then move it back.
                          <div className="mt-0.5 flex flex-col gap-1.5">
                            <textarea
                              ref={editRef}
                              value={editText}
                              onChange={(e) => {
                                setEditText(e.target.value);
                                autosize(e.currentTarget);
                              }}
                              onKeyDown={onEditKeyDown}
                              rows={1}
                              aria-label={t('editAction')}
                              className="border-border focus:border-primary text-foreground w-full resize-none rounded-md border bg-transparent px-2 py-1 text-sm outline-none"
                            />
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={cancelEdit}
                                aria-label={t('editCancel')}
                                title={t('editCancel')}
                                className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 place-items-center rounded-md transition-colors"
                              >
                                <X className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={commitEdit}
                                aria-label={t('editSave')}
                                title={t('editSave')}
                                className="bg-primary hover:bg-primary-hover grid size-7 place-items-center rounded-md text-white transition-colors"
                              >
                                <Check className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-foreground text-sm break-words whitespace-pre-wrap">
                            {message.body}
                          </p>
                        )}

                        <div className="mt-0.5 flex items-center justify-end gap-1.5">
                          {/* "editada" is what earns the edit. A message
                              that can change without saying so is a message
                              nobody can quote back at you. */}
                          {message.edited_at && !editing && (
                            <span className="text-muted-foreground/80 text-3xs italic">
                              {t('edited')}
                            </span>
                          )}
                          <span className="text-muted-foreground text-3xs">
                            {format(new Date(message.created_at), 'HH:mm')}
                          </span>
                        </div>
                      </div>

                      {/* The menu keeps its 16px whether or not it can act,
                          so a run of bubbles keeps one left edge — a control
                          that appears and reflows the message it belongs to
                          is a control you chase.

                          Revealed on hover AND on keyboard focus: something
                          reachable by Tab that stays invisible is a trap. */}
                      <span className="w-4 shrink-0 self-center">
                        {(mine || canModerate) && !editing && !pending && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label={t('messageActions')}
                              className="text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:opacity-100 grid size-6 place-items-center rounded-md opacity-0 transition-opacity group-hover/msg:opacity-100 focus-visible:opacity-100"
                            >
                              <MoreVertical className="size-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align={mine ? 'end' : 'start'}
                              className="min-w-36"
                            >
                              {/* Editing is the author's alone — an admin
                                  may remove a message, never rewrite one
                                  into somebody else's mouth. RLS says the
                                  same thing (046's UPDATE policy checks
                                  authorship and nothing else); this is the
                                  interface agreeing with it up front
                                  instead of finding out at the round
                                  trip. */}
                              {mine && (
                                <DropdownMenuItem
                                  onClick={() => startEdit(message)}
                                >
                                  <Pencil className="size-4" />
                                  {t('editAction')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => remove(message)}
                              >
                                <Trash2 className="size-4" />
                                {t('deleteAction')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer — the pill, and nothing else. No clip, no microphone, no
          templates: this room sends text between colleagues.

          The PILL takes the focus ring now, rather than leaving the textarea
          inside it to glow on its own. What you are typing into is the whole
          rounded box; a highlight on only the inner rectangle read as a
          second, misaligned field sitting inside the first. Same
          `focus-within` recipe the inbox composer uses. */}
      <div className="px-3 pt-3 pb-safe-3 sm:px-4">
        <div className="border-border bg-card-2 focus-within:border-primary/40 focus-within:ring-primary/15 flex items-end gap-1 rounded-3xl border px-1.5 py-1 transition-colors focus-within:ring-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autosize(e.currentTarget);
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
              // `min-h-9` matches the send button beside it, so an empty
              // composer is one bar rather than a short field with a taller
              // button parked next to it.
              'text-foreground placeholder-muted-foreground min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-snug outline-none',
              (!canWrite || pending) && 'cursor-not-allowed opacity-50'
            )}
          />
          <GatedButton
            size="sm"
            canAct={canWrite && !pending}
            gateReason="send messages"
            disabled={!text.trim() || sending}
            onClick={send}
            aria-label={t('send')}
            title={t('send')}
            className="bg-primary hover:bg-primary-hover size-9 shrink-0 rounded-full p-0 disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
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
