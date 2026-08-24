'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import type {
  Automation,
  AutomationLog,
  AutomationLogStepResult,
} from '@/types';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatePanel } from '@/components/ui/state-panel';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/automations/trigger-meta';
import { PageHeader } from '@/components/layout/page-header';

export default function AutomationLogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const t = useTranslations('Automations.logs');

  const [automation, setAutomation] = useState<Automation | null>(null);
  const [logs, setLogs] = useState<AutomationLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLogId, setOpenLogId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [autRes, logRes] = await Promise.all([
          supabase.from('automations').select('*').eq('id', id).maybeSingle(),
          supabase
            .from('automation_logs')
            .select('*, contact:contacts(id, name, phone)')
            .eq('automation_id', id)
            .order('created_at', { ascending: false })
            .limit(100),
        ]);
        if (autRes.error) throw autRes.error;
        if (logRes.error) throw logRes.error;
        setAutomation(autRes.data as Automation | null);
        setLogs((logRes.data ?? []) as AutomationLog[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('loadError'));
      }
    }
    load();
  }, [id]);

  if (error) {
    return (
      <StatePanel
        size="md"
        icon={AlertTriangle}
        title={t('loadError')}
        description={error === t('loadError') ? undefined : error}
        actions={
          <Button variant="outline" onClick={() => router.push('/automations')}>
            {t('back')}
          </Button>
        }
      />
    );
  }

  if (!automation || logs === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {/* A <Button>, not a bare <button>: the 44px coarse-pointer target
            in globals.css keys off [data-slot="button"], and this is the
            only way back from a page people open on a phone. */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/automations')}
          aria-label={t('backAria')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <PageHeader title={automation.name} description={t('title')} />
      </div>

      {logs.length === 0 ? (
        <StatePanel
          framed
          icon={FileText}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const isOpen = openLogId === log.id;
            return (
              <li
                key={log.id}
                className="border-border bg-card rounded-lg border"
              >
                <button
                  type="button"
                  onClick={() => setOpenLogId(isOpen ? null : log.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <LogStatusBadge status={log.status} t={t} />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate text-sm font-medium">
                      {log.contact?.name ??
                        log.contact?.phone ??
                        t('unknownContact')}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {log.trigger_event} · {log.steps_executed?.length ?? 0}{' '}
                      {log.steps_executed?.length === 1
                        ? t('step', { count: 1 }).replace('1 ', '')
                        : t('stepPlural', {
                            count: log.steps_executed?.length ?? 0,
                          }).replace(/^[0-9]+ /, '')}
                    </div>
                  </div>
                  <div className="text-muted-foreground text-2xs shrink-0 tabular-nums">
                    {formatRelative(log.created_at)}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-border border-t px-4 py-3">
                    {log.error_message && (
                      <p className="border-danger/25 bg-danger-soft text-danger-ink mb-3 rounded-md border px-3 py-2 text-xs leading-relaxed">
                        {log.error_message}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {(log.steps_executed ?? []).map((r, i) => (
                        <StepRow key={i} result={r} />
                      ))}
                      {(log.steps_executed ?? []).length === 0 && (
                        <li className="text-muted-foreground text-xs">
                          {t('noSteps')}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * A run's outcome, in the system's state vocabulary.
 *
 * Success is GREY, not green. Almost every row in a healthy log is a
 * success, and a hundred green chips is not "confirmed, used sparingly" —
 * it is a wall the eye stops reading, which is exactly when the two rows
 * that failed stop standing out. Grey is also the honest colour here: a
 * run that worked is the machine doing its job, which is information.
 * Partial takes amber because a half-finished run is the one case where
 * somebody has to go look.
 */
const LOG_STATUS_VARIANT: Record<
  AutomationLog['status'],
  'auto' | 'human' | 'danger'
> = {
  success: 'auto',
  partial: 'human',
  failed: 'danger',
};

function LogStatusBadge({
  status,
  t,
}: {
  status: AutomationLog['status'];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <StatusBadge variant={LOG_STATUS_VARIANT[status] ?? 'neutral'}>
      {t(`status.${status}`)}
    </StatusBadge>
  );
}

function StepRow({ result }: { result: AutomationLogStepResult }) {
  const ok = result.status === 'success';
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full',
          ok ? 'bg-ok-soft text-ok-ink' : 'bg-danger-soft text-danger-ink'
        )}
        aria-hidden
      >
        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>
      <span className="text-muted-foreground">{result.step_type}</span>
      {result.detail && (
        <span className="text-muted-foreground truncate">
          — {result.detail}
        </span>
      )}
    </li>
  );
}
