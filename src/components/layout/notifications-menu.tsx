'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck, Loader2, UserPlus, WifiOff } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { useWhatsAppConnected } from '@/hooks/use-whatsapp-connected';
import { useMemberNames } from '@/hooks/use-member-names';
import { notificationText } from '@/lib/notifications/text';

/** The row plus the one embed the panel asks for. */
type NotificationRow = Notification & {
  contact?: { name: string | null; phone: string | null } | null;
};
import { dateFnsOptions } from '@/lib/i18n/dates';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/** One icon per type. Only one type exists today; new ones are a line each. */
const TYPE_ICON: Record<Notification['type'], typeof Bell> = {
  conversation_assigned: UserPlus,
};

/** Enough to answer "anything new?" without becoming a page. */
const PANEL_LIMIT = 8;

/**
 * Where a notification takes you, or null when it takes you nowhere.
 *
 * The row was a `<button>` with a hover state and a pointer cursor
 * whatever it carried, and the handler navigated only when
 * `conversation_id` was set — both fields on `Notification` are
 * optional. So a row without one marked itself read, closed the panel,
 * and left you exactly where you were. The honest reading of a click
 * that changes nothing is "it did not register", and the next thing a
 * person does is click again.
 *
 * The contact is the fallback because it is the one thing every
 * notification in this product is about: `conversation_assigned` is
 * currently the only type, and it always concerns somebody. When even
 * that is missing the row renders as a `<div>` — no hover, no cursor,
 * no promise.
 */
function destinationFor(n: Notification): string | null {
  if (n.conversation_id) return `/inbox?c=${n.conversation_id}`;
  if (n.contact_id) return `/contacts?id=${n.contact_id}`;
  return null;
}

/**
 * The bell, and what is behind it.
 *
 * Notifications were a destination: the bell was a `<Link>` to
 * `/notifications`, so "did anything happen?" cost a navigation away from
 * whatever you were doing and a navigation back. For a list that is empty most
 * of the time and three rows long the rest of it, that is the wrong shape —
 * the question is a glance, not a visit.
 *
 * So the bell opens a panel. The page still exists, unchanged, and is one
 * click away under "ver todas": the panel shows the newest eight, and anyone
 * who needs history, or the full mark-all-read pass, goes there.
 *
 * Rows are fetched when the panel opens, not on mount. The unread COUNT is
 * already live on every page through `useUnreadNotifications` (one `head:true`
 * count plus a realtime subscription); loading eight full rows on every page
 * as well would be a query per navigation to render something nobody looked at.
 *
 * The WhatsApp connection is pinned at the top of the panel. It used to be a
 * strip in the shell above every route, which meant a standing account state
 * took a band of vertical space out of every page — including the inbox and
 * the pipeline board, two full-height surfaces that budget their own height
 * and got shoved down by it. Same reasoning as the bell itself: a state you
 * glance at belongs behind the bell, not stapled to the top of the work.
 */
export function NotificationsMenu({ className }: { className?: string }) {
  const t = useTranslations('Notifications');
  const tWhatsApp = useTranslations('WhatsAppAlert');
  const router = useRouter();
  const { accountId } = useAuth();
  const unread = useUnreadNotifications();
  // `null` while unknown — see the hook. Only an answered "no" shows up here.
  const needsWhatsApp = useWhatsAppConnected() === false;

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const memberNames = useMemberNames();
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('notifications')
      // The contact's name so the row can be composed in the interface's
      // language instead of read out of the column the trigger wrote in
      // English. See `@/lib/notifications/text`.
      .select('*, contact:contacts(name, phone)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(PANEL_LIMIT);
    setRows((data ?? []) as NotificationRow[]);
  }, [accountId]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Re-fetched on every open rather than cached: the panel is the thing you
    // check to find out what changed, so showing a stale list is the one
    // failure it cannot have.
    if (next) load();
  }

  async function openNotification(n: Notification) {
    setOpen(false);
    if (!n.read_at) {
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r
          ) ?? prev
      );
      const supabase = createClient();
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', n.id)
        .is('read_at', null);
    }
    const to = destinationFor(n);
    if (to) router.push(to);
  }

  async function markAllRead() {
    if (marking || unread === 0) return;
    setMarking(true);
    const now = new Date().toISOString();
    setRows(
      (prev) =>
        prev?.map((r) => (r.read_at ? r : { ...r, read_at: now })) ?? prev
    );
    const supabase = createClient();
    await supabase
      .from('notifications')
      .update({ read_at: now })
      .is('read_at', null);
    setMarking(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={
          unread > 0
            ? t('unreadCountAria', { count: unread })
            : needsWhatsApp
              ? t('setupNeededAria')
              : t('title')
        }
        title={t('title')}
        className={cn(
          'hover:bg-muted text-muted-foreground hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground relative inline-flex size-9 items-center justify-center rounded-md transition-colors',
          // The inbox mounts a second one of these at the size of its own
          // controls — see the note at the call site there.
          className
        )}
      >
        {/* Arbitrary value, not `size-4.5`: Tailwind generates no rule for
            that one, so the icon falls back to lucide's 24px default and
            towers over everything else in the bar. */}
        <Bell className="size-4.5" strokeWidth={1.75} />
        {unread > 0 ? (
          <span className="bg-human-strong text-3xs absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : (
          // A dot, never a "1": the connection is a state, not an unread
          // item, and folding it into the count would make the number lie
          // about how many things happened.
          needsWhatsApp && (
            <span
              aria-hidden
              className="bg-human-strong absolute top-1.5 right-1.5 size-2 rounded-full"
            />
          )
        )}
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={6} className="w-80 gap-0 p-0">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="text-foreground flex-1 text-sm font-semibold">
            {t('title')}
          </span>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              disabled={marking}
              className="text-muted-foreground hover:text-foreground text-2xs inline-flex items-center gap-1 rounded-md font-medium transition-colors disabled:opacity-50"
            >
              {marking ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <CheckCheck className="size-3" />
              )}
              {t('markAllRead')}
            </button>
          )}
        </div>

        {/* Pinned, not listed: this did not happen at a time, it is simply
            true until somebody connects the number. So it sits outside the
            scroll area, above the feed, and never ages out of it. */}
        {needsWhatsApp && (
          <Link
            href="/settings?tab=whatsapp"
            onClick={() => setOpen(false)}
            // No fill at rest. It sat on `bg-human-soft` inside a panel where
            // every other row is `--popover`, so the one standing state read
            // louder than the things that actually just happened. Same answer
            // the quick actions got: one box for every row, the tone carried
            // by the ink and the glyph, the fill kept for the pointer. See
            // `quickActionVariants` in ui/side-panel.tsx.
            className="border-border/70 text-human-ink hover:bg-human-soft flex items-start gap-2.5 border-t px-3 py-2.5 transition-colors"
          >
            {/* The same 24px tile every notification row wears below, so the
                banner shares the panel's skeleton instead of being a bare
                icon floating at a different x. */}
            <span
              aria-hidden
              className="bg-muted text-human mt-0.5 grid size-6 shrink-0 place-items-center rounded-md"
            >
              <WifiOff className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-2xs block leading-snug font-medium">
                {tWhatsApp('notConnected')}
              </span>
              <span className="text-2xs mt-1 block font-semibold underline underline-offset-2">
                {tWhatsApp('connect')}
              </span>
            </span>
          </Link>
        )}

        <div className="border-border/70 max-h-80 overflow-y-auto border-y">
          {rows === null ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-xs">
              {t('emptyTitle')}
            </p>
          ) : (
            <ul>
              {rows.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isUnread = !n.read_at;
                const clickable = destinationFor(n) !== null || isUnread;
                const Row = clickable ? 'button' : 'div';
                return (
                  <li key={n.id}>
                    <Row
                      {...(clickable
                        ? {
                            type: 'button' as const,
                            onClick: () => openNotification(n),
                          }
                        : {})}
                      className={cn(
                        // Unread is not a fill either — it is the bold ink,
                        // the accented tile and the dot, three signals that
                        // do not tint a whole row.
                        'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
                        clickable && 'hover:bg-muted'
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md',
                          isUnread
                            ? 'bg-primary/15 text-primary'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'truncate text-xs font-semibold',
                              isUnread
                                ? 'text-foreground'
                                : 'text-muted-foreground'
                            )}
                          >
                            {
                              notificationText(n, t, {
                                actor: n.actor_user_id
                                  ? memberNames.get(n.actor_user_id)
                                  : null,
                                contact: n.contact?.name || n.contact?.phone,
                              }).title
                            }
                          </span>
                          {isUnread && (
                            <span
                              aria-label={t('unreadAria')}
                              className="bg-primary size-1.5 shrink-0 rounded-full"
                            />
                          )}
                        </span>
                        {(() => {
                          const { body } = notificationText(n, t, {
                            actor: n.actor_user_id
                              ? memberNames.get(n.actor_user_id)
                              : null,
                            contact: n.contact?.name || n.contact?.phone,
                          });
                          return body ? (
                            <span className="text-muted-foreground text-2xs mt-0.5 block truncate">
                              {body}
                            </span>
                          ) : null;
                        })()}
                        <span className="text-muted-foreground/70 text-3xs mt-0.5 block">
                          {formatDistanceToNow(new Date(n.created_at), {
                            addSuffix: true,
                            ...dateFnsOptions,
                          })}
                        </span>
                      </span>
                    </Row>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="text-primary hover:bg-muted block px-3 py-2 text-center text-xs font-semibold transition-colors"
        >
          {t('viewAll')}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
