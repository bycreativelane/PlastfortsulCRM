'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Users,
  Send,
  CheckCheck,
  Eye,
  AlertCircle,
  MessageCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  PlayCircle,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { getBroadcastStatus, getRecipientStatus } from '@/lib/broadcast-status';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { formatPhone } from '@/lib/whatsapp/phone-format';
import { APP_LOCALE } from '@/lib/i18n/locale';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatePanel } from '@/components/ui/state-panel';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from '@/components/ui/panel';
import { Skeleton } from '@/components/dashboard/skeleton';

/**
 * A tile caption carrying its share of the total.
 *
 * The percentage used to be a lone number floating in the tile's top
 * right, unrelated to anything nearby. Sitting after the caption it
 * reads as one phrase — "Entregues · 92%" — and `tabular-nums` keeps
 * the six of them from jittering as the poll refreshes counts.
 */
function StatLabel({
  text,
  value,
  total,
}: {
  text: string;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      {text}
      <span className="text-muted-foreground text-xs tabular-nums">{pct}%</span>
    </span>
  );
}

interface FunnelStep {
  label: string;
  value: number;
  /** Tailwind bg class for the fill. See the ramp note in `funnelSteps`. */
  fill: string;
}

/**
 * Pure-CSS funnel chart: decreasing-width rounded bars.
 * Width is relative to the largest step (typically Sent) so we
 * always render a full bar at the top and proportional tails.
 *
 * Declares its own `useTranslations` because it is defined above the
 * page component and cannot borrow the page's `t`.
 */
function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const t = useTranslations('Broadcasts.detail');
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <Panel className="p-4">
      <h3 className="text-foreground mb-4 text-sm font-semibold tracking-tight">
        {t('funnel')}
      </h3>
      <div className="space-y-2">
        {steps.map((step) => {
          const pctOfMax = Math.max(5, Math.round((step.value / max) * 100));
          const pctOfSent =
            steps[0].value > 0
              ? Math.round((step.value / steps[0].value) * 100)
              : 0;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="text-muted-foreground w-20 shrink-0 text-xs">
                {step.label}
              </span>
              <div className="bg-muted relative h-7 min-w-0 flex-1 rounded-full">
                <div
                  className={`h-7 rounded-full ${step.fill} transition-[width] duration-(--dur-3)`}
                  style={{ width: `${pctOfMax}%` }}
                />
                <span className="text-foreground absolute inset-0 flex items-center px-3 text-xs font-medium tabular-nums">
                  {step.value.toLocaleString(APP_LOCALE)}
                  <span className="text-muted-foreground ml-2">
                    ({pctOfSent}%)
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
];

/**
 * CSV export helper — RFC 4180 quoting. Quote every field so
 * commas/newlines/quotes round-trip cleanly.
 */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('Broadcasts.detail');
  const tStatus = useTranslations('Broadcasts.status');
  const broadcastId = params.id as string;

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>(
    'all'
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resumingScope, setResumingScope] = useState<
    'pending' | 'failed' | null
  >(null);

  const fetchData = useCallback(async () => {
    try {
      const supabase = createClient();

      const { data: bc, error: bcError } = await supabase
        .from('broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

      if (bcError) throw bcError;
      setBroadcast(bc);

      const { data: recs, error: recsError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcastId)
        .order('created_at', { ascending: false });

      if (recsError) throw recsError;
      setRecipients(recs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notFound'));
    } finally {
      setLoading(false);
    }
  }, [broadcastId, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter]
  );

  function handleExport() {
    if (!broadcast) return;
    const header = [
      t('table.contact'),
      t('table.phone'),
      t('table.status'),
      t('table.sent'),
      t('table.delivered'),
      t('table.read'),
      t('table.error'),
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sent_at ?? '',
      r.delivered_at ?? '',
      r.read_at ?? '',
      r.error_message ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name
      .replace(/[^a-z0-9-_]+/gi, '-')
      .toLowerCase();
    downloadBlob(`broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  /**
   * Hand the leftovers to the server (issue #472).
   *
   * The wizard's send loop lives in the tab that started the campaign,
   * so navigating away strands the rest as 'pending' with the broadcast
   * stuck 'sending'. This is the recovery, and the same call retries
   * failed recipients.
   */
  async function handleResume(scope: 'pending' | 'failed') {
    setResumingScope(scope);
    try {
      const res = await fetch(`/api/whatsapp/broadcast/${broadcastId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(
          t('toastResumeFailed', {
            error: payload?.error || `HTTP ${res.status}`,
          })
        );
        return;
      }

      toast.success(
        payload.remaining > 0
          ? t('toastResumeStartedCapped', {
              count: payload.resuming,
              remaining: payload.remaining,
            })
          : t('toastResumeStarted', { count: payload.resuming })
      );
      // Delivery runs server-side after the 202, so the counts here are
      // a snapshot — reload to pick up the first of it.
      await fetchData();
    } catch (err) {
      toast.error(
        t('toastResumeFailed', {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    } finally {
      setResumingScope(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    const supabase = createClient();
    // broadcast_recipients cascades on broadcasts.id (migration 001), so a
    // single delete is sufficient — the aggregate trigger in migration 003
    // is defined on broadcast_recipients but fires only on its own row
    // changes, not on a cascaded drop of the parent row.
    const { error: delErr } = await supabase
      .from('broadcasts')
      .delete()
      .eq('id', broadcastId);
    setDeleting(false);
    if (delErr) {
      toast.error(t('toastFailedDelete', { error: delErr.message }));
      return;
    }
    toast.success(t('toastDeleted'));
    router.push('/broadcasts');
  }

  // Skeleton in the shape of what is coming — six tiles, a funnel, a
  // table — rather than a 256px spinner that throws the header away and
  // then drops the real page in from an arbitrary height.
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border-border bg-card flex items-center gap-3 rounded-lg border p-4"
            >
              <Skeleton className="size-9 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="mt-1 h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-52 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <StatePanel
        size="md"
        framed
        icon={AlertCircle}
        title={t('notFound')}
        description={error ?? undefined}
        actions={
          <Button variant="outline" onClick={() => router.push('/broadcasts')}>
            {t('backToBroadcasts')}
          </Button>
        }
      />
    );
  }

  const status = getBroadcastStatus(broadcast.status);

  const pendingCount = recipients.filter((r) => r.status === 'pending').length;
  const retryableCount = recipients.filter((r) => r.status === 'failed').length;
  // A campaign whose tab went away sits in 'sending' with recipients
  // still pending and nothing left to move them. Name that state rather
  // than leaving a permanently pulsing "sending" badge.
  const isStalled = broadcast.status === 'sending' && pendingCount > 0;

  // One hue, four steps. These bars used to be primary / teal / blue /
  // indigo, which put four different meanings-worth of colour on a
  // sequence that is already ordered top to bottom and already labelled
  // — and teal-400 / indigo-400 are not remapped for light mode, so two
  // of the four were unreadable there. A descending opacity ramp says
  // "same thing, less of it", which is what a funnel is. The ramp tops
  // out at 60% deliberately: the value sits ON the bar in `text-
  // foreground`, and a solid accent fill under near-black text fails
  // contrast in light mode.
  const funnelSteps: FunnelStep[] = [
    {
      label: t('stats.sent'),
      value: broadcast.sent_count,
      fill: 'bg-primary/60',
    },
    {
      label: t('stats.delivered'),
      value: broadcast.delivered_count,
      fill: 'bg-primary/45',
    },
    {
      label: t('stats.read'),
      value: broadcast.read_count,
      fill: 'bg-primary/30',
    },
    {
      label: t('stats.replied'),
      value: broadcast.replied_count,
      fill: 'bg-primary/20',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header.
          The way back is a breadcrumb ABOVE the title, not an icon
          button beside it. Beside it, a 32px control plus a 16px gap
          pushed the `<h1>` 48px off the column every other page's title
          starts on, so moving between a list and its detail shifted the
          whole page sideways. Above it, the title keeps the shell's
          axis and the link gets to name where it goes. `-ml-2.5`
          cancels the button's own side padding so the label — not its
          box — lands on that axis. */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/broadcasts')}
          className="text-muted-foreground hover:text-foreground mb-2 -ml-2.5"
        >
          <ArrowLeft />
          {t('backToBroadcasts')}
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            className="min-w-0 flex-1"
            title={broadcast.name}
            badge={
              <StatusBadge variant={status.variant}>
                {tStatus(status.label)}
              </StatusBadge>
            }
            description={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span>{t('template', { name: broadcast.template_name })}</span>
                <span aria-hidden>·</span>
                <span>
                  {t('createdAt', {
                    date: new Date(broadcast.created_at).toLocaleDateString(
                      APP_LOCALE
                    ),
                  })}
                </span>
              </span>
            }
          />

          {/* Delete — inline-confirm pattern matches the pipeline-settings
              "Delete Pipeline" flow. Mid-send broadcasts can't be deleted
              because orphaning in-flight Meta messages would leave the
              funnel inconsistent. */}
          {confirmDelete ? (
            <div className="border-danger-ink/25 bg-danger-soft mt-0.5 flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="text-danger-ink text-sm">
                {t('deletePrompt')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? t('deleting') : t('confirm')}
              </Button>
            </div>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              disabled={broadcast.status === 'sending'}
              onClick={() => setConfirmDelete(true)}
              title={
                broadcast.status === 'sending'
                  ? t('cannotDeleteSending')
                  : t('deleteHover')
              }
              className="mt-0.5"
            >
              <Trash2 />
              {t('delete')}
            </Button>
          )}
        </div>
      </div>

      {/* Resume / retry (issue #472). Only rendered when there is
          actually something outstanding. */}
      {(pendingCount > 0 || retryableCount > 0) && (
        <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0 text-sm">
            <p className="text-foreground font-medium">
              {isStalled ? t('resumeStalledTitle') : t('resumeTitle')}
            </p>
            <p className="text-muted-foreground mt-0.5">
              {isStalled
                ? t('resumeStalledHint', { count: pendingCount })
                : t('resumeHint', { count: retryableCount })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pendingCount > 0 && (
              <Button
                size="sm"
                onClick={() => handleResume('pending')}
                disabled={resumingScope !== null}
              >
                {resumingScope === 'pending' ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <PlayCircle />
                )}
                {t('resumePending', { count: pendingCount })}
              </Button>
            )}
            {retryableCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleResume('failed')}
                disabled={resumingScope !== null}
              >
                {resumingScope === 'failed' ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                {t('retryFailed', { count: retryableCount })}
              </Button>
            )}
          </div>
        </Panel>
      )}

      {/* Stats — 6 tiles: Total / Sent / Delivered / Read / Replied / Failed.
          These were six hand-rolled cards, each with its own hue: primary,
          teal, blue, indigo and red lit at once, plus four more colours in
          the funnel below and a badge per table row. Nothing there meant
          "act" — they were stages of an ordered sequence — so amber stopped
          meaning anything on this route. Only `failed` keeps colour now.

          Six across at `lg` gave each tile ~160px, which a 24px number and
          a two-word caption do not fit. Two rows of three on the house
          ladder instead. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          icon={<Users />}
          value={broadcast.total_recipients.toLocaleString(APP_LOCALE)}
          label={t('stats.totalRecipients')}
        />
        <StatTile
          icon={<Send />}
          value={broadcast.sent_count.toLocaleString(APP_LOCALE)}
          label={
            <StatLabel
              text={t('stats.sent')}
              value={broadcast.sent_count}
              total={broadcast.total_recipients}
            />
          }
        />
        <StatTile
          icon={<CheckCheck />}
          value={broadcast.delivered_count.toLocaleString(APP_LOCALE)}
          label={
            <StatLabel
              text={t('stats.delivered')}
              value={broadcast.delivered_count}
              total={broadcast.total_recipients}
            />
          }
        />
        <StatTile
          icon={<Eye />}
          value={broadcast.read_count.toLocaleString(APP_LOCALE)}
          label={
            <StatLabel
              text={t('stats.read')}
              value={broadcast.read_count}
              total={broadcast.total_recipients}
            />
          }
        />
        <StatTile
          icon={<MessageCircle />}
          value={broadcast.replied_count.toLocaleString(APP_LOCALE)}
          label={
            <StatLabel
              text={t('stats.replied')}
              value={broadcast.replied_count}
              total={broadcast.total_recipients}
            />
          }
        />
        <StatTile
          tone={broadcast.failed_count > 0 ? 'danger' : 'neutral'}
          icon={<AlertCircle />}
          value={broadcast.failed_count.toLocaleString(APP_LOCALE)}
          label={
            <StatLabel
              text={t('stats.failed')}
              value={broadcast.failed_count}
              total={broadcast.total_recipients}
            />
          }
        />
      </div>

      <FunnelChart steps={funnelSteps} />

      {/* Recipients Table */}
      <Panel>
        <PanelHeader className="flex-wrap">
          <PanelTitle>
            {statusFilter !== 'all'
              ? t('recipientsHeader', {
                  filtered: filteredRecipients.length,
                  total: recipients.length,
                })
              : t('recipientsHeaderAll', { total: recipients.length })}
          </PanelTitle>
          <PanelActions className="flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" />}
              >
                <Filter />
                {statusFilter === 'all'
                  ? t('allStatuses')
                  : tStatus(getRecipientStatus(statusFilter).label)}
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={
                    statusFilter === 'all'
                      ? 'text-primary'
                      : 'text-popover-foreground'
                  }
                >
                  {t('allStatuses')}
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={
                      statusFilter === s
                        ? 'text-primary'
                        : 'text-popover-foreground'
                    }
                  >
                    {tStatus(getRecipientStatus(s).label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={recipients.length === 0}
            >
              <Download />
              {t('exportCsv')}
            </Button>
          </PanelActions>
        </PanelHeader>

        {filteredRecipients.length === 0 ? (
          <StatePanel
            icon={Users}
            title={
              recipients.length === 0
                ? t('noRecipients')
                : t('noRecipientsFilter')
            }
          />
        ) : (
          // `Table` already renders its own `overflow-x-auto` container;
          // the extra wrapper that used to be here nested two scrollers
          // and only the inner one moved.
          <PanelBody flush>
            <Table>
              {/* Seven nowrap columns is ~750px of minimum width, so at
                  360px the error column — the reason anyone opens this
                  screen — sat two full screens of horizontal scroll to
                  the right. Same progression the campaigns and contacts
                  tables already use; the error text is repeated under
                  the contact name below `lg` so narrow screens never
                  lose it. */}
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">
                    {t('table.contact')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden sm:table-cell">
                    {t('table.phone')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('table.status')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden sm:table-cell">
                    {t('table.sent')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden md:table-cell">
                    {t('table.delivered')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden md:table-cell">
                    {t('table.read')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden lg:table-cell">
                    {t('table.error')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  return (
                    <TableRow key={recipient.id} className="border-border">
                      <TableCell className="text-foreground font-medium">
                        {recipient.contact?.name ?? t('unknownContact')}
                        {recipient.error_message ? (
                          <span className="text-danger-ink text-2xs mt-0.5 block font-normal whitespace-normal lg:hidden">
                            {recipient.error_message}
                          </span>
                        ) : null}
                        <span className="text-muted-foreground text-2xs mt-0.5 block font-normal sm:hidden">
                          {recipient.contact?.phone
                            ? formatPhone(recipient.contact.phone)
                            : '-'}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">
                        {recipient.contact?.phone
                          ? formatPhone(recipient.contact.phone)
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge variant={rStatus.variant}>
                          {tStatus(rStatus.label)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden tabular-nums sm:table-cell">
                        {recipient.sent_at
                          ? new Date(recipient.sent_at).toLocaleString(
                              APP_LOCALE
                            )
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden tabular-nums md:table-cell">
                        {recipient.delivered_at
                          ? new Date(recipient.delivered_at).toLocaleString(
                              APP_LOCALE
                            )
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden tabular-nums md:table-cell">
                        {recipient.read_at
                          ? new Date(recipient.read_at).toLocaleString(
                              APP_LOCALE
                            )
                          : '-'}
                      </TableCell>
                      <TableCell className="text-danger-ink hidden max-w-xs truncate text-xs lg:table-cell">
                        {recipient.error_message ?? '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </PanelBody>
        )}
      </Panel>
    </div>
  );
}
