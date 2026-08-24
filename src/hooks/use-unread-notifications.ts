'use client';

import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';

/**
 * Count of unread notifications for the current user.
 *
 * ONE SUBSCRIPTION, however many components ask. That is not an
 * optimisation — it is the bug fix.
 *
 * This used to open `supabase.channel('notifications-unread-count')` inside
 * the hook's own effect. The browser client is memoised and `.channel(name)`
 * returns the SAME channel for the same name, so the second component to
 * mount the hook called `.on()` on a channel the first had already
 * `subscribe()`d, and supabase-js throws outright:
 *
 *     cannot add `postgres_changes` callbacks for
 *     realtime:notifications-unread-count after `subscribe()`
 *
 * Thrown from an effect, that unmounts the tree and lands on the route's
 * error boundary — the whole screen replaced by "algo quebrou", from a badge.
 * It was latent for as long as there was exactly one bell; adding a second
 * one to the inbox is what fired it.
 *
 * So the channel lives here, at module scope, with a reference count: the
 * first consumer starts it, the last one to leave stops it, and the count is
 * one number every consumer reads. `useSyncExternalStore` is the same
 * primitive `use-nav-collapsed` uses for the same reason — an external source
 * of truth that React should read rather than mirror.
 */

let count = 0;
let refs = 0;
let channel: RealtimeChannel | null = null;
/** Guards against a stale in-flight count landing after a restart. */
let generation = 0;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setCount(next: number): void {
  const clamped = Math.max(0, next);
  if (clamped === count) return;
  count = clamped;
  emit();
}

function start(): void {
  const supabase = createClient();
  const mine = ++generation;

  (async () => {
    // `head: true` skips the rows — only the count comes back. RLS on
    // `notifications` already scopes every read to `auth.uid() = user_id`,
    // so there is no filter to write here.
    const { count: unread, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .is('read_at', null);
    if (error || mine !== generation) return;
    setCount(unread ?? 0);
  })();

  channel = supabase
    .channel('notifications-unread-count')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as Notification;
          if (!row.read_at) setCount(count + 1);
        } else if (payload.eventType === 'UPDATE') {
          // Updates here only ever set `read_at`. Derived purely from the
          // new row so this does not depend on `payload.old`, which needs
          // REPLICA IDENTITY FULL.
          const row = payload.new as Notification;
          if (row.read_at) setCount(count - 1);
        } else if (payload.eventType === 'DELETE') {
          const row = payload.old as Partial<Notification>;
          if (!row.read_at) setCount(count - 1);
        }
      }
    )
    .subscribe();
}

function stop(): void {
  generation += 1;
  if (channel) {
    createClient().removeChannel(channel);
    channel = null;
  }
  count = 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  refs += 1;
  if (refs === 1) start();

  return () => {
    listeners.delete(listener);
    refs -= 1;
    if (refs === 0) stop();
  };
}

export function useUnreadNotifications(): number {
  return useSyncExternalStore(
    subscribe,
    () => count,
    // Server render: nobody is signed in yet and there is no socket.
    () => 0
  );
}
