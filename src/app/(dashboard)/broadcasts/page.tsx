'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Radio, Plus, AlertCircle } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { PageActions } from '@/components/layout/page-actions';
import { getBroadcastStatus } from '@/lib/broadcast-status';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatePanel } from '@/components/ui/state-panel';
import { Skeleton } from '@/components/dashboard/skeleton';

/**
 * Poll cadence while any broadcast is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function RateCell({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary" */
  color: string;
}) {
  const pct = percent(value, total);
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
        {pct}%
      </span>
      <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BroadcastsPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.page');
  const tStatus = useTranslations('Broadcasts.status');
  const canCreate = useCan('send-messages');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Used to kick off polling only while something is actively sending.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchBroadcasts() {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setBroadcasts(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBroadcasts();
  }, []);

  const anySending = useMemo(
    () => broadcasts.some((b) => b.status === 'sending'),
    [broadcasts]
  );

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchBroadcasts, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    // Pause polling while the tab is hidden — keeps Supabase cold when
    // the user is away, and ensures a fresh fetch the moment they
    // refocus so they don't see stale data on return.
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchBroadcasts();
        startPolling();
      }
    }

    if (anySending && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending]);

  // The page keeps its title while it loads, and the placeholder has the
  // shape of the list that is coming. The old branch replaced the whole
  // route with a 256px spinner, so the header vanished and the real
  // layout then materialised from an arbitrary height.
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <div className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-2.5">
              <Skeleton className="h-4 w-40 max-w-[40%]" />
              <Skeleton className="hidden h-4 w-24 md:block" />
              <Skeleton className="ml-auto h-5 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <StatePanel
          size="md"
          framed
          icon={AlertCircle}
          title={t('errorLoad')}
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

  return (
    <div className="space-y-6">
      {/* Top indeterminate progress bar: only visible while a broadcast
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label={t('inProgressAria')}
          className="broadcast-indeterminate bg-muted fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden"
        >
          <div className="broadcast-indeterminate-bar bg-primary h-0.5" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      <PageActions>
        {/* `title` rather than `gateReason`: GatedButton builds its own
            tooltip from `gateReason` as an English sentence, and this
            app is pt-BR. Passing the finished string keeps the viewer's
            explanation in the product's language. */}
        <GatedButton
          size="sm"
          canAct={canCreate}
          title={canCreate ? undefined : t('readOnlyCreate')}
          onClick={() => router.push('/broadcasts/new')}
        >
          <Plus />
          {t('newBroadcast')}
        </GatedButton>
      </PageActions>

      <PageHeader title={t('title')} description={t('subtitle')} />

      {broadcasts.length === 0 ? (
        <StatePanel
          size="md"
          framed
          icon={Radio}
          title={t('noBroadcastsYet')}
          description={t('createFirst')}
          actions={
            <GatedButton
              canAct={canCreate}
              title={canCreate ? undefined : t('readOnlyCreate')}
              onClick={() => router.push('/broadcasts/new')}
            >
              <Plus />
              {t('newBroadcast')}
            </GatedButton>
          }
        />
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">
                  {t('table.name')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden md:table-cell">
                  {t('table.template')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden text-right sm:table-cell">
                  {t('table.recipients')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden lg:table-cell">
                  {t('table.delivery')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden lg:table-cell">
                  {t('table.read')}
                </TableHead>
                <TableHead className="text-muted-foreground">
                  {t('table.status')}
                </TableHead>
                <TableHead className="text-muted-foreground hidden sm:table-cell">
                  {t('table.date')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {broadcasts.map((broadcast) => {
                const status = getBroadcastStatus(broadcast.status);
                return (
                  <TableRow
                    key={broadcast.id}
                    className="border-border hover:bg-muted/50 cursor-pointer"
                    onClick={() => router.push(`/broadcasts/${broadcast.id}`)}
                  >
                    <TableCell className="text-foreground font-medium">
                      {broadcast.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">
                      {broadcast.template_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-right tabular-nums sm:table-cell">
                      {broadcast.total_recipients}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.delivered_count}
                        total={broadcast.total_recipients}
                        color="bg-primary"
                      />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RateCell
                        value={broadcast.read_count}
                        total={broadcast.total_recipients}
                        color="bg-primary/45"
                      />
                    </TableCell>
                    <TableCell>
                      {/* A STATIC dot, not a ping. Several rows can be
                          sending at once, and a permanent pulse on each
                          of them competes for attention all day for no
                          gain — the recipient and delivery columns
                          beside it already carry the progress. */}
                      <StatusBadge variant={status.variant}>
                        {status.live ? (
                          <span
                            aria-hidden
                            className="bg-auto-ink size-1.5 shrink-0 rounded-full"
                          />
                        ) : null}
                        {tStatus(status.label)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      {new Date(broadcast.created_at).toLocaleDateString(APP_LOCALE)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
