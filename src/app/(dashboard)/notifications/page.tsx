'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useWhatsAppConnected } from '@/hooks/use-whatsapp-connected';
import type { Notification } from '@/types';
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Loader2,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PageActions } from '@/components/layout/page-actions';
import { PageHeader } from '@/components/layout/page-header';
import { StatePanel } from '@/components/ui/state-panel';
import { dateLocale } from '@/lib/i18n/dates';
import { useMemberNames } from '@/hooks/use-member-names';
import { notificationText } from '@/lib/notifications/text';

/** The row plus the one embed this page asks for. */
type NotificationRow = Notification & {
  contact?: { name: string | null; phone: string | null } | null;
};

// Icon per notification type. Only one type exists today
// (conversation_assigned) but this keeps future types a one-line add.
const TYPE_ICON: Record<Notification['type'], typeof Bell> = {
  conversation_assigned: UserPlus,
};

export default function NotificationsPage() {
  const t = useTranslations('Notifications');
  const tWhatsApp = useTranslations('WhatsAppAlert');
  const router = useRouter();
  const { accountId } = useAuth();
  // Mirrors the bell panel — see `NotificationsMenu`. "Ver todas" must not
  // be the click that makes a standing warning disappear.
  const needsWhatsApp = useWhatsAppConnected() === false;
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(
    null
  );
  const memberNames = useMemberNames();
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from('notifications')
      // See the panel, and `@/lib/notifications/text`: the stored title and
      // body are English literals from a Postgres trigger, so the contact's
      // name comes along and the row is composed in the app's language.
      .select('*, contact:contacts(name, phone)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as NotificationRow[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Realtime — new assignments appear without a refresh, and a
  // "mark all read" fired from another tab/device stays in sync here.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('notifications-page')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Notification;
            setNotifications(
              (prev) =>
                prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
                prev
            );
          } else if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic — the row is already visually "read" by the time the
      // request lands, so the UI doesn't wait on the round-trip.
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n
          ) ?? prev
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (updateErr) {
        toast.error(t('toastFailedMarkRead'));
        load();
      }
    },
    [load, t]
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router]
  );

  const unreadIds =
    notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications(
      (prev) =>
        prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev
    );
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .is('read_at', null);
    setMarkingAll(false);
    if (updateErr) {
      toast.error(t('toastFailedMarkAll'));
      load();
    }
  }, [unreadIds.length, load, t]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('description')} />
        <StatePanel
          size="md"
          icon={AlertTriangle}
          title={t('errorTitle')}
          description={error}
          actions={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t('retry')}
            </Button>
          }
        />
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* The action goes through <PageActions>, which portals into the slot
          inside <PageHeader>. It used to be the header's SIBLING in an
          `items-center` row, so it centred against the height of title +
          description and sat a few pixels below where every other page puts
          its primary action — and the page opted out of the system that
          decides where actions live at all. */}
      <PageActions>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadIds.length === 0 || markingAll}
          onClick={markAllRead}
        >
          {markingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="h-4 w-4" />
          )}
          {t('markAllRead')}
        </Button>
      </PageActions>

      <PageHeader title={t('title')} description={t('description')} />

      {/* Pinned above the feed, not filed in it: this is not something
          that happened at a time, it is true until somebody connects the
          number, and it cannot be marked read. */}
      {needsWhatsApp && (
        <Link
          href="/settings?tab=whatsapp"
          // A card like the rows below it, with amber only in the ink — see
          // the twin in layout/notifications-menu.tsx. `surface-interactive`
          // owns the hover and the transition.
          className="surface-interactive border-border bg-card text-human-ink flex items-start gap-3 rounded-lg border p-4"
        >
          <span className="bg-muted text-human grid size-8 shrink-0 place-items-center rounded-lg">
            <WifiOff className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {tWhatsApp('notConnected')}
            </span>
            <span className="mt-1 block text-xs font-semibold underline underline-offset-2">
              {tWhatsApp('connect')}
            </span>
          </span>
        </Link>
      )}

      {notifications.length === 0 ? (
        // `framed` because this slot has no panel of its own around it.
        <StatePanel
          framed
          icon={Bell}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const isUnread = !n.read_at;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className={cn(
                    'surface-interactive flex w-full items-start gap-3 rounded-lg border p-4 text-left',
                    // Unread moves the BORDER, never the fill: the panel and
                    // this page used to disagree (`bg-primary-soft/40` there,
                    // `bg-primary/5` here) about a tint neither should have
                    // had.
                    isUnread
                      ? 'border-primary/30 bg-card'
                      : 'border-border bg-card'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
                      isUnread ? 'bg-primary/15' : 'bg-muted'
                    )}
                    aria-hidden
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5',
                        isUnread ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-semibold',
                          isUnread ? 'text-foreground' : 'text-muted-foreground'
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
                          className="bg-primary h-2 w-2 flex-shrink-0 rounded-full"
                        />
                      )}
                    </div>
                    {(() => {
                      const { body } = notificationText(n, t, {
                        actor: n.actor_user_id
                          ? memberNames.get(n.actor_user_id)
                          : null,
                        contact: n.contact?.name || n.contact?.phone,
                      });
                      return body ? (
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">
                          {body}
                        </p>
                      ) : null;
                    })()}
                    <p className="text-muted-foreground/70 text-2xs mt-1">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
