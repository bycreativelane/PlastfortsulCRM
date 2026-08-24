'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ListChecks, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import type { PlaybookStep } from '@/types';
import { PlaybookEditor } from './playbook-editor';

interface PlaybookChecklistProps {
  dealId: string;
  stageId: string;
  /** Shown while editing, so an admin knows which stage they are changing. */
  stageName: string;
  /** Called after a tick lands, so the board's counter can catch up. */
  onProgressChanged?: () => void;
}

/**
 * The stage's checklist, on the deal.
 *
 * "Where is this deal" is what the board answers. This answers "and therefore
 * what" — the question that decides whether a lead moves on Tuesday or sits
 * in Qualified for eleven days because the next move lived in one person's
 * head.
 *
 * It renders nothing at all when the stage has no playbook. A section header
 * over an empty list is worse than no section: it teaches you that this part
 * of the form is usually empty, and then you stop looking at it on the stages
 * where it is not.
 *
 * Ticks are optimistic and non-blocking. The worst case for a checkbox that
 * lied is that you tick it again; the worst case for one that waits on a
 * round-trip is that you stop trusting the list, which is fatal for a tool
 * whose only job is being glanced at.
 */
export function PlaybookChecklist({
  dealId,
  stageId,
  stageName,
  onProgressChanged,
}: PlaybookChecklistProps) {
  const t = useTranslations('Pipelines.playbook');
  const supabase = createClient();
  const { accountId } = useAuth();
  const canAct = useCan('send-messages');
  const canEdit = useCan('edit-settings');

  const [steps, setSteps] = useState<PlaybookStep[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!stageId) return;
    const [stepRes, progressRes] = await Promise.all([
      supabase
        .from('playbook_steps')
        .select('*')
        .eq('stage_id', stageId)
        .order('position'),
      supabase
        .from('deal_playbook_progress')
        .select('step_id')
        .eq('deal_id', dealId),
    ]);
    setSteps((stepRes.data ?? []) as PlaybookStep[]);
    setDone(
      new Set(
        ((progressRes.data ?? []) as { step_id: string }[]).map(
          (r) => r.step_id
        )
      )
    );
  }, [supabase, stageId, dealId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSteps(null);
    load();
  }, [load]);

  async function toggle(step: PlaybookStep) {
    if (!canAct || !accountId || pending.has(step.id)) return;
    const wasDone = done.has(step.id);

    setPending((prev) => new Set(prev).add(step.id));
    setDone((prev) => {
      const next = new Set(prev);
      if (wasDone) next.delete(step.id);
      else next.add(step.id);
      return next;
    });

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { error } = wasDone
      ? await supabase
          .from('deal_playbook_progress')
          .delete()
          .eq('deal_id', dealId)
          .eq('step_id', step.id)
      : // Upsert-ignore, not insert: two agents ticking the same box at the
        // same moment both write, and the loser of that race would get a
        // 23505 on the composite primary key. A duplicate tick is somebody
        // agreeing with what is already on screen, not an error to show them.
        await supabase.from('deal_playbook_progress').upsert(
          {
            deal_id: dealId,
            step_id: step.id,
            account_id: accountId,
            done_by: session?.user?.id ?? null,
          },
          { onConflict: 'deal_id,step_id', ignoreDuplicates: true }
        );

    setPending((prev) => {
      const next = new Set(prev);
      next.delete(step.id);
      return next;
    });

    if (error) {
      // Put it back. A checkbox that silently disagrees with the database is
      // the one failure this component must not have.
      setDone((prev) => {
        const next = new Set(prev);
        if (wasDone) next.add(step.id);
        else next.delete(step.id);
        return next;
      });
      toast.error(t('toastFailed'));
      return;
    }
    onProgressChanged?.();
  }

  if (!steps) return null;

  if (editing) {
    return (
      <PlaybookEditor
        stageId={stageId}
        stageName={stageName}
        steps={steps}
        onDone={() => {
          setEditing(false);
          load();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // No playbook for this stage. An agent sees nothing — a section header over
  // an empty list teaches you to stop looking at that part of the form. An
  // admin sees the one line that lets the first one exist, because a feature
  // reachable only from a stage that already uses it can never be started.
  if (steps.length === 0) {
    if (!canEdit) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="border-input text-muted-foreground hover:border-primary/40 hover:text-foreground duration-(--dur-1) pointer-coarse:py-3.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-xs transition-colors"
      >
        <ListChecks className="size-3.5" />
        {t('addForStage', { stage: stageName })}
      </button>
    );
  }

  const doneCount = steps.filter((s) => done.has(s.id)).length;
  const complete = doneCount === steps.length;

  return (
    <div className="border-border bg-muted/50 space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <p className="text-muted-foreground eyebrow flex-1">
          {t('title')}
        </p>
        <span
          className={cn(
            'text-3xs shrink-0 rounded-full px-1.5 font-bold tabular-nums',
            complete ? 'bg-ok-soft text-ok-ink' : 'bg-human-soft text-human-ink'
          )}
        >
          {doneCount}/{steps.length}
        </span>
        {canEdit && (
          // `Button` for the same 28px box plus the coarse-pointer hit
          // shield: this is the smallest target in a sheet used one-handed.
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setEditing(true)}
            title={t('edit')}
            aria-label={t('edit')}
            className="text-muted-foreground hover:bg-card hover:text-foreground"
          >
            <Pencil className="size-3" />
          </Button>
        )}
      </div>

      <ul className="space-y-0.5">
        {steps.map((step) => {
          const isDone = done.has(step.id);
          const isPending = pending.has(step.id);
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => toggle(step)}
                disabled={!canAct}
                aria-pressed={isDone}
                className={cn(
                  // A list row, so it stays a bare `<button>` rather than a
                  // `Button` — but it is still a tick box on a phone, and at
                  // `py-2` the row stood 34px. The extra padding on coarse
                  // pointers only is what gets it to 44 without loosening
                  // the list for everyone reading it with a mouse.
                  'hover:bg-card duration-(--dur-1) pointer-coarse:py-3 flex w-full items-start gap-2 rounded-md px-1.5 py-2 text-left transition-colors',
                  !canAct && 'cursor-default hover:bg-transparent'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-px grid size-4 shrink-0 place-items-center rounded-sm border transition-colors duration-(--dur-1)',
                    isDone
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-card'
                  )}
                >
                  {isPending ? (
                    <Loader2 className="size-2.5 animate-spin" />
                  ) : isDone ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-sm leading-snug',
                      isDone
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground'
                    )}
                  >
                    {step.title}
                  </span>
                  {step.hint && !isDone && (
                    <span className="text-muted-foreground text-2xs mt-0.5 block leading-snug">
                      {step.hint}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
