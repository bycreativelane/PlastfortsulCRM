'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  CircleCheck,
  CircleAlert,
  Clock,
  UserPlus,
  PlayCircle,
  PauseCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { StatePanel } from '@/components/ui/state-panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { dateLocale } from '@/lib/i18n/dates';

/**
 * Run history viewer.
 *
 * Lists the 50 most recent runs for a flow, newest first. Each row
 * collapses to a one-liner (contact + status + time); expanding shows
 * the full `flow_run_events` timeline for that run — useful for
 * debugging "why didn't my flow advance?" by surfacing the engine's
 * own log.
 */

interface RunRow {
  id: string;
  status:
    | 'active'
    | 'completed'
    | 'handed_off'
    | 'timed_out'
    | 'paused_by_agent'
    | 'failed';
  current_node_key: string | null;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  contact: { id: string; name: string | null; phone: string } | null;
}

interface EventRow {
  flow_run_id: string;
  event_type: string;
  node_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Per-status chip variant + icon. There is no `label` here on purpose:
 * the visible text is resolved through `t('status…')` at the render
 * site, and an English label sitting in this table only invited the
 * next person to render it untranslated.
 *
 * Only three of the six carry colour. `handed_off` is amber because it
 * is the one outcome that ends with a person owing the conversation an
 * answer; the rest of the terminal states are information, and grey.
 */
const STATUS_META: Record<
  RunRow['status'],
  {
    variant: 'neutral' | 'ok' | 'human' | 'danger';
    icon: typeof Clock;
  }
> = {
  active: { variant: 'ok', icon: PlayCircle },
  completed: { variant: 'neutral', icon: CircleCheck },
  handed_off: { variant: 'human', icon: UserPlus },
  timed_out: { variant: 'neutral', icon: Clock },
  paused_by_agent: { variant: 'neutral', icon: PauseCircle },
  failed: { variant: 'danger', icon: CircleAlert },
};

export default function FlowRunsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const t = useTranslations('Flows.logs');
  const tEdit = useTranslations('Flows.edit');

  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}/runs`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as {
          flow: { id: string; name: string };
          runs: RunRow[];
          events: EventRow[];
        };
        if (!cancelled) {
          setFlow(json.flow);
          setRuns(json.runs ?? []);
          setEvents(json.events ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t('loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  function toggle(runId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (loading) {
    // `h-64` and not `h-full`: this route is document-shaped, so the
    // shell wraps it in an auto-height column — `h-full` resolves
    // against nothing and the spinner ends up pinned to the top edge
    // instead of centred. Same height the other document-shaped
    // loaders use.
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (notFound || !flow) {
    return (
      <StatePanel
        size="md"
        icon={CircleAlert}
        title={tEdit('notFound')}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/flows')}
          >
            {tEdit('backToFlows')}
          </Button>
        }
      />
    );
  }

  return (
    // `space-y-6` and no container of its own. This page used to carry
    // `mx-auto max-w-4xl p-6`: a measure nothing else in the app used,
    // and a second 24px of padding inside the shell's own gutters. The
    // shell owns both now — see dashboard-shell.tsx.
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/flows/${flow.id}`)}
          className="text-muted-foreground hover:text-foreground mb-1 -ml-2.5"
        >
          <ArrowLeft />
          {flow.name}
        </Button>
        <PageHeader title={t('title')} description={t('description')} />
      </div>

      {runs.length === 0 ? (
        <StatePanel size="md" framed icon={PlayCircle} title={t('emptyState')} />
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              events={events.filter((e) => e.flow_run_id === run.id)}
              expanded={expanded.has(run.id)}
              onToggle={() => toggle(run.id)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  events,
  expanded,
  onToggle,
  t,
}: {
  run: RunRow;
  events: EventRow[];
  expanded: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const meta = STATUS_META[run.status];
  const StatusIcon = meta.icon;
  const contactLabel =
    run.contact?.name?.trim() || run.contact?.phone || t('unknownContact');
  const duration = run.ended_at
    ? formatDistanceToNow(new Date(run.ended_at), {
        addSuffix: false,
        locale: dateLocale,
      })
    : null;
  return (
    <div className="border-border bg-card rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground truncate text-sm font-medium">
              {contactLabel}
            </span>
            <StatusBadge variant={meta.variant}>
              <StatusIcon />
              {t(
                run.status === 'active'
                  ? 'statusActive'
                  : run.status === 'completed'
                    ? 'statusCompleted'
                    : run.status === 'handed_off'
                      ? 'statusHandedOff'
                      : run.status === 'timed_out'
                        ? 'statusTimedOut'
                        : run.status === 'paused_by_agent'
                          ? 'statusPaused'
                          : 'statusFailed'
              )}
            </StatusBadge>
            {run.status === 'active' && run.current_node_key && (
              <code className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-3xs">
                {t('atNode', { node: run.current_node_key })}
              </code>
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-2xs">
            <span>
              {t('started', {
                time: format(new Date(run.started_at), 'PP p', {
                  locale: dateLocale,
                }),
              })}
            </span>
            {run.reprompt_count > 0 && (
              <span>· {t('reprompts', { count: run.reprompt_count })}</span>
            )}
            {duration && <span>· {t('ranFor', { duration })}</span>}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-border border-t px-4 py-3">
          {Object.keys(run.vars).length > 0 && (
            <details className="mb-3">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                {t('capturedVars', { count: Object.keys(run.vars).length })}
              </summary>
              <pre className="bg-background text-muted-foreground mt-2 overflow-x-auto rounded-md p-2 text-2xs">
                {JSON.stringify(run.vars, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex flex-col gap-1">
            {events.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t('noEvents')}</p>
            ) : (
              events.map((ev, ix) => <EventLine key={ix} ev={ev} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Timeline tone per event type. `text-sky-300` used to sit on
 * `message_sent`, and sky is one of the few raw Tailwind families the
 * theme does NOT re-point at a doctrine token — on the white card it
 * landed under 2:1. Machine steps are `auto` (grey ink, information),
 * the contact's own reply keeps the accent, and only the handoff
 * spends amber: it is the line that means a person now owes an answer.
 */
const EVENT_COLOR: Record<string, string> = {
  started: 'text-ok-ink',
  node_entered: 'text-muted-foreground',
  message_sent: 'text-auto-ink',
  reply_received: 'text-primary',
  fallback_fired: 'text-auto-ink',
  handoff: 'text-human-ink',
  timeout: 'text-muted-foreground',
  error: 'text-danger-ink',
  completed: 'text-ok-ink',
};

function EventLine({ ev }: { ev: EventRow }) {
  const cls = EVENT_COLOR[ev.event_type] ?? 'text-muted-foreground';
  return (
    // Two `w-32` columns were 256px of the ~296px a phone leaves inside
    // this card, so the node chip and payload were pushed off the row.
    // Sized to their actual content instead: a fixed-width clock and a
    // column wide enough for the longest event type.
    <div className="flex items-start gap-2 rounded-md px-2 py-1 text-xs">
      <span className="text-muted-foreground w-14 shrink-0 text-3xs tabular-nums">
        {format(new Date(ev.created_at), 'HH:mm:ss')}
      </span>
      <span className={cn('w-28 shrink-0 truncate font-mono text-3xs', cls)}>
        {ev.event_type}
      </span>
      {ev.node_key && (
        <code className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1 py-0.5 text-3xs">
          {ev.node_key}
        </code>
      )}
      {Object.keys(ev.payload).length > 0 && (
        <span className="text-muted-foreground min-w-0 truncate text-3xs">
          {summarizePayload(ev.payload)}
        </span>
      )}
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  // Show the keys that matter most to a human debugger; full JSON is
  // available via the "Captured vars" details panel for the run.
  const keys = ['reply_id', 'captured_key', 'reason', 'advancing_to'];
  for (const k of keys) {
    if (k in payload && payload[k] !== null && payload[k] !== undefined) {
      return `${k}=${String(payload[k]).slice(0, 80)}`;
    }
  }
  return '';
}
