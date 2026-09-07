'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Check,
  Clock,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
} from 'lucide-react';

import type { Task } from '@/types';
import { TASK_KINDS } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useBusinessHours } from '@/hooks/use-business-hours';
import { useMemberDirectory } from '@/hooks/use-member-directory';
import { localParts } from '@/lib/automations/local-time';
import { fromISO } from '@/lib/calendar';
import { formatTime } from '@/components/ui/time-field';
import {
  countTasks,
  isDueToday,
  isOverdue,
  loadTasksFor,
  sortTasks,
} from '@/lib/tasks/queries';
import { completeTask, reopenTask } from '@/lib/tasks/mutations';
import { publishTask } from '@/lib/calendar-sync/publish-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatePanel } from '@/components/ui/state-panel';
import { TaskDialog, type TaskDialogTarget } from './task-dialog';

/**
 * As tarefas de um contato ou de uma oportunidade.
 *
 * O bloco inteiro: carrega, desenha, conclui e abre o formulário. É assim
 * porque as três superfícies que o usam — a aba do contato, o painel da
 * caixa de entrada e a ficha da oportunidade — querem a MESMA coisa, e a
 * alternativa (cada tela montando a sua a partir de `lib/tasks`) é como três
 * telas acabam discordando sobre o que é uma tarefa atrasada.
 *
 * CONCLUIR É UM CLIQUE, na própria linha. Uma caixa de seleção e nada mais:
 * o momento de dizer "liguei" é o momento em que se desligou o telefone, e
 * qualquer diálogo no caminho é o motivo pelo qual, um mês depois, a lista
 * está cheia de coisas feitas que ninguém marcou.
 *
 * AS CONCLUÍDAS FICAM, embaixo e apagadas. `042` já argumentou isto para
 * ocorrências e vale igual aqui: "já ligamos na semana passada" é o que se
 * quer ler antes de ligar de novo.
 */
export function TaskList({
  target,
  title,
  emptyHint,
  className,
}: {
  target: TaskDialogTarget;
  title?: string;
  emptyHint?: string;
  className?: string;
}) {
  const t = useTranslations('Tasks');
  const locale = useLocale();
  const { accountId, canSendMessages } = useAuth();
  const { hours } = useBusinessHours();
  const members = useMemberDirectory();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const todayIso = useMemo(
    () => localParts(new Date(), hours.timezone).dateKey,
    [hours.timezone]
  );

  const load = useCallback(async () => {
    if (!accountId) return;
    const rows = await loadTasksFor(createClient(), {
      contactId: target.contact_id,
      dealId: target.deal_id,
    });
    setTasks(rows);
  }, [accountId, target.contact_id, target.deal_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function toggle(task: Task) {
    setBusy(task.id);
    const db = createClient();
    const ok =
      task.status === 'done'
        ? await reopenTask(db, task.id)
        : await completeTask(db, task.id);
    setBusy(null);
    if (!ok) {
      toast.error(t('saveFailed'));
      return;
    }
    // Regra 4 do §D5: concluir não apaga o evento — marca o título com um
    // visto. Reabrir tira o visto. As duas passam pela mesma reconciliação.
    void publishTask(task.id);
    await load();
  }

  const counts = tasks ? countTasks(tasks, todayIso) : null;
  const open = tasks ? sortTasks(tasks.filter((x) => x.status === 'open')) : [];
  const closed = tasks
    ? sortTasks(tasks.filter((x) => x.status !== 'open'))
    : [];

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-foreground text-sm font-semibold">
            {title ?? t('sectionTitle')}
          </h3>
          {counts && counts.overdue > 0 && (
            <span className="bg-danger-soft text-danger-ink rounded-md px-1.5 py-0.5 text-xs font-medium">
              {t('overdueCount', { count: counts.overdue })}
            </span>
          )}
        </div>

        {canSendMessages && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            {t('new')}
          </Button>
        )}
      </div>

      {tasks === null ? (
        <div className="flex justify-center py-6">
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <StatePanel
          icon={ListChecks}
          title={t('empty')}
          description={emptyHint}
        />
      ) : (
        <div className="space-y-1">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              todayIso={todayIso}
              locale={locale}
              assignee={
                task.assigned_to
                  ? (members.get(task.assigned_to)?.full_name ?? null)
                  : null
              }
              busy={busy === task.id}
              canWrite={canSendMessages}
              onToggle={() => toggle(task)}
              onEdit={() => {
                setEditing(task);
                setDialogOpen(true);
              }}
              t={t}
            />
          ))}

          {closed.length > 0 && (
            <details className="group pt-1">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-xs font-medium">
                {t('doneCount', { count: closed.length })}
              </summary>
              <div className="mt-1 space-y-1">
                {closed.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    todayIso={todayIso}
                    locale={locale}
                    assignee={
                      task.assigned_to
                        ? (members.get(task.assigned_to)?.full_name ?? null)
                        : null
                    }
                    busy={busy === task.id}
                    canWrite={canSendMessages}
                    onToggle={() => toggle(task)}
                    onEdit={() => {
                      setEditing(task);
                      setDialogOpen(true);
                    }}
                    t={t}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editing}
        target={target}
        onSaved={load}
      />
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations<'Tasks'>>;

/**
 * O nome do tipo, ou o próprio tipo.
 *
 * `tasks.kind` é TEXT e a 068 aceita o que a conta escrever — é a mesma
 * doutrina da 042 para tipos de ocorrência. Então traduzir só o que está em
 * `TASK_KINDS` não é cautela: `t()` LANÇA numa chave que não existe, e uma
 * conta que criasse o tipo "Cobrança" derrubaria a lista inteira.
 */
function kindLabel(kind: string, t: Translator): string {
  return (TASK_KINDS as readonly string[]).includes(kind)
    ? t(`kind.${kind}` as 'kind.call')
    : kind;
}

/**
 * Uma linha.
 *
 * O prazo é o que dá a cor: vermelho é atraso, âmbar é hoje, cinza é
 * depois. Nenhuma delas é o tipo da tarefa — uma ligação e uma visita
 * atrasadas são igualmente atrasadas, e colorir por tipo gastaria a única
 * dimensão visual que a lista tem numa informação que o texto já dá.
 */
function TaskRow({
  task,
  todayIso,
  locale,
  assignee,
  busy,
  canWrite,
  onToggle,
  onEdit,
  t,
}: {
  task: Task;
  todayIso: string;
  locale: string;
  assignee: string | null;
  busy: boolean;
  canWrite: boolean;
  onToggle: () => void;
  onEdit: () => void;
  t: Translator;
}) {
  const done = task.status !== 'open';
  const overdue = isOverdue(task, todayIso);
  const today = isDueToday(task, todayIso);

  return (
    <div className="hover:bg-muted/50 group flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors">
      <button
        type="button"
        disabled={!canWrite || busy}
        onClick={onToggle}
        aria-label={done ? t('reopen') : t('complete')}
        className={cn(
          'mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-colors',
          done
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input hover:border-primary',
          !canWrite && 'cursor-not-allowed opacity-50'
        )}
      >
        {busy ? (
          <Loader2 className="size-2.5 animate-spin" />
        ) : done ? (
          task.status === 'done' ? (
            <Check className="size-3" />
          ) : (
            <RotateCcw className="size-2.5" />
          )
        ) : null}
      </button>

      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 text-left"
      >
        <p
          className={cn(
            'truncate text-sm',
            done ? 'text-muted-foreground line-through' : 'text-foreground'
          )}
        >
          {task.title}
        </p>

        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span>{kindLabel(task.kind, t)}</span>

          {task.due_on && (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                !done && overdue && 'text-danger font-medium',
                !done && today && 'text-human-ink font-medium'
              )}
            >
              <Clock className="size-3" />
              {formatDue(task, todayIso, locale, t)}
            </span>
          )}

          {assignee && <span className="truncate">{assignee}</span>}
        </div>
      </button>
    </div>
  );
}

/** "Hoje 14:00", "Atrasada · 8 set", "12 set" — o mínimo que responde. */
function formatDue(
  task: Task,
  todayIso: string,
  locale: string,
  t: Translator
): string {
  if (!task.due_on) return '';
  const time = task.due_time
    ? formatTime(task.due_time.slice(0, 5), locale)
    : '';

  if (task.due_on === todayIso) {
    return time ? t('dueTodayAt', { time }) : t('dueToday');
  }

  const date = fromISO(task.due_on);
  const day = date
    ? new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
      }).format(date)
    : task.due_on;

  const label = time ? `${day} ${time}` : day;
  return task.status === 'open' && task.due_on < todayIso
    ? t('dueOverdue', { day: label })
    : label;
}
