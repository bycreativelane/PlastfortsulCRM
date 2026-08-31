'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Inbox,
  Loader2,
  RotateCcw,
} from 'lucide-react';

import { dateLocale } from '@/lib/i18n/dates';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/dashboard/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { cn } from '@/lib/utils';

/**
 * What arrived, and what it caused.
 *
 * ------------------------------------------------------------------
 * THE SECOND HALF IS THE POINT
 * ------------------------------------------------------------------
 *
 * A list of payloads answers "did it reach me". The question people
 * actually arrive with is "it reached me and nothing happened" — and
 * that one is only answerable next to the automation runs the payload
 * caused, with the steps each one executed.
 *
 * Hence the three states a delivery can show, which are three different
 * problems with three different fixes:
 *
 *   nothing ran      no automation listens to `webhook_received`, or
 *                    every one of them failed its conditions
 *   ran and failed   the automation is wired but a step broke
 *   ran and skipped  the step was refused for scope — the hook is not
 *                    allowed to send messages
 *
 * The third is the one that would otherwise look like a bug and is a
 * setting. `runStep` writes that sentence into the step result, so it
 * shows up here as itself.
 */

interface Run {
  id: string;
  automation_id: string;
  status: 'success' | 'partial' | 'failed';
  error_message: string | null;
  steps_executed: { step_type?: string; result?: string; error?: string }[];
  created_at: string;
  automation?: { name?: string } | { name?: string }[] | null;
}

interface Delivery {
  id: string;
  received_at: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  payload: Record<string, unknown> | null;
  error: string | null;
  runs: Run[];
}

export function HookDeliveries({ hookId }: { hookId: string }) {
  const t = useTranslations('Settings.hooks');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchDeliveries = useCallback(async () => {
    const res = await fetch(`/api/account/hooks/${hookId}/deliveries`);
    if (!res.ok) return [];
    const json = (await res.json()) as { deliveries?: Delivery[] };
    return json.deliveries ?? [];
  }, [hookId]);

  useEffect(() => {
    let cancelled = false;
    void fetchDeliveries().then((rows) => {
      if (cancelled) return;
      setDeliveries(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchDeliveries]);

  async function refresh() {
    setRefreshing(true);
    setDeliveries(await fetchDeliveries());
    setRefreshing(false);
  }

  if (loading) return <Skeleton className="h-32 w-full" />;

  if (deliveries.length === 0) {
    return (
      <StatePanel
        icon={Inbox}
        title={t('noDeliveries')}
        description={t('noDeliveriesHint')}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          {t('refresh')}
        </Button>
      </div>

      {deliveries.map((delivery) => {
        const open = openId === delivery.id;
        const failed = delivery.runs.some((r) => r.status === 'failed');
        const nothingRan =
          delivery.status === 'accepted' && delivery.runs.length === 0;

        return (
          <div key={delivery.id} className="border-border rounded-lg border">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : delivery.id)}
              className="hover:bg-muted/50 flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
            >
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-md',
                  delivery.status === 'rejected' || failed
                    ? 'bg-danger-soft text-danger-ink'
                    : nothingRan
                      ? 'bg-human-soft text-human-ink'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {delivery.status === 'rejected' || failed ? (
                  <AlertTriangle className="size-3.5" />
                ) : nothingRan ? (
                  <AlertTriangle className="size-3.5" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-sm">
                  {/* The sentence that names the actual problem, rather
                      than the word "accepted" — which is true and
                      useless when nothing happened afterwards. */}
                  {delivery.status === 'rejected'
                    ? (delivery.error ?? t('rejected'))
                    : delivery.status === 'duplicate'
                      ? t('duplicate')
                      : nothingRan
                        ? t('nothingRan')
                        : t('ranCount', { count: delivery.runs.length })}
                </span>
                <span className="text-muted-foreground block text-2xs">
                  {formatDistanceToNow(new Date(delivery.received_at), {
                    addSuffix: true,
                    locale: dateLocale,
                  })}
                </span>
              </span>

              <ChevronDown
                className={cn(
                  'text-muted-foreground size-4 shrink-0 transition-transform',
                  open && 'rotate-180'
                )}
              />
            </button>

            {open && (
              <div className="border-border space-y-3 border-t p-3">
                {nothingRan && (
                  <p className="bg-human-soft text-human-ink rounded-md px-2.5 py-2 text-xs">
                    {t('nothingRanHint')}
                  </p>
                )}

                {delivery.runs.map((run) => {
                  const automation = Array.isArray(run.automation)
                    ? run.automation[0]
                    : run.automation;
                  return (
                    <div key={run.id} className="space-y-1">
                      <p className="text-foreground text-xs font-medium">
                        {automation?.name ?? t('unnamedAutomation')}
                        <span
                          className={cn(
                            'ml-2 rounded-full px-1.5 py-0.5 text-3xs font-semibold',
                            run.status === 'failed'
                              ? 'bg-danger-soft text-danger-ink'
                              : run.status === 'partial'
                                ? 'bg-human-soft text-human-ink'
                                : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {run.status}
                        </span>
                      </p>
                      {run.error_message && (
                        <p className="text-danger-ink text-2xs">
                          {run.error_message}
                        </p>
                      )}
                      {/* Step by step. This is where "skipped: hook is
                          not allowed to send messages" surfaces — the
                          one failure that is a setting, not a bug. */}
                      <ol className="text-muted-foreground space-y-0.5 text-2xs">
                        {(run.steps_executed ?? []).map((step, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span className="font-mono">{step.step_type}</span>
                            <span className="min-w-0 flex-1 truncate">
                              {step.error ?? step.result ?? ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })}

                {/* The payload last: it is what somebody checks after
                    the runs have not explained it. */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-muted-foreground text-2xs font-semibold">
                      {t('payload')}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          JSON.stringify(delivery.payload ?? {}, null, 2)
                        )
                      }
                    >
                      <Copy className="size-3" />
                      {t('copy')}
                    </Button>
                  </div>
                  <pre className="bg-card-2 border-border max-h-48 overflow-auto rounded-md border p-2 font-mono text-3xs">
                    {JSON.stringify(delivery.payload ?? {}, null, 2)}
                  </pre>
                  {/* The names as a template would address them. Reading
                      them off the JSON means guessing how nesting was
                      flattened, which is the most common reason a
                      `{{vars.x}}` comes out empty. */}
                  {delivery.payload && (
                    <p className="text-muted-foreground mt-1.5 text-3xs">
                      {t('varsHint')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
