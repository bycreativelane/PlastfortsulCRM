'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  ListChecks,
  Plus,
  RotateCcw,
  Search,
  User as UserIcon,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useMemberDirectory } from '@/hooks/use-member-directory';
import { createClient } from '@/lib/supabase/client';
import { fromISO } from '@/lib/calendar';
import { localParts } from '@/lib/automations/local-time';
import { useBusinessHours } from '@/hooks/use-business-hours';
import {
  closedTasks,
  filterTasks,
  groupTasks,
  summarize,
  type TaskBucket,
} from '@/lib/tasks/board';
import { loadAllTasks } from '@/lib/tasks/queries';
import { cancelTask, completeTask, reopenTask } from '@/lib/tasks/mutations';
import { notifyTaskCompleted, publishTask } from '@/lib/tasks/notify-client';
import { TASK_KINDS, type Task, type TaskStatus } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MemberAvatar } from '@/components/presence/member-avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TaskDialog } from '@/components/tasks/task-dialog';
import { TasksBoard } from '@/components/tasks/tasks-board';
import { TasksCalendar } from '@/components/tasks/tasks-calendar';

/**
 * Tarefas — a fila, e não o tempo.
 *
 * ------------------------------------------------------------------
 * DUAS TELAS, DOIS RECORTES
 * ------------------------------------------------------------------
 *
 * A `/agenda` desenha o TEMPO: em que dia e a que hora as coisas caem, ao
 * lado de tudo mais que tem data. Esta desenha a FILA: o que eu tenho para
 * fazer, em ordem de urgência, sem nada que não seja trabalho meu.
 *
 * São perguntas diferentes e a mesma tela não responde bem às duas. Um
 * calendário não sabe mostrar "sete atrasadas" sem espalhá-las por sete
 * dias passados; uma lista não sabe mostrar "a quinta está livre".
 *
 * O §C4 do plano tinha recusado esta tela, e o argumento era bom para quem
 * trabalha dentro de um atendimento — a tarefa nasce numa conversa e é lá
 * que ela é lembrada. Ele erra para quem abre o CRM de manhã e pergunta
 * "o que eu tenho hoje?", que é uma pergunta sem cliente e sem conversa.
 *
 * ------------------------------------------------------------------
 * ATRASADAS PRIMEIRO, E EM VERMELHO
 * ------------------------------------------------------------------
 *
 * O que venceu não entra na ordem cronológica junto com o resto. Uma lista
 * ordenada só por data enterra o que venceu na semana passada acima do que
 * vence hoje — visualmente correto e inútil, porque o que venceu é
 * exatamente o que precisa de decisão agora.
 */
export function TasksPage() {
  const t = useTranslations('TasksPage');
  const tk = useTranslations('Tasks');
  const format = useFormatter();
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const { hours } = useBusinessHours();
  const members = useMemberDirectory();

  const me = user?.id ?? null;
  const todayIso = React.useMemo(
    () => localParts(new Date(), hours.timezone).dateKey,
    [hours.timezone]
  );

  const [tasks, setTasks] = React.useState<Task[] | null>(null);
  const [owner, setOwner] = React.useState<'all' | 'mine' | string>('mine');
  const [hiddenKinds, setHiddenKinds] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [search, setSearch] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showClosed, setShowClosed] = React.useState(false);
  const [mode, setMode] = React.useState<'list' | 'board' | 'calendar'>(
    'list'
  );
  const [editing, setEditing] = React.useState<Task | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setTasks(await loadAllTasks(createClient()));
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // `?task=<id>` abre a gaveta — o mesmo endereço que a agenda e as
  // notificações de lembrete apontam, para que um link só sirva às duas.
  const openTaskId = params.get('task');
  React.useEffect(() => {
    if (!openTaskId || !tasks) return;
    const found = tasks.find((task) => task.id === openTaskId);
    if (found) setEditing(found);
  }, [openTaskId, tasks]);

  const visible = React.useMemo(
    () => filterTasks(tasks ?? [], { owner, me, hiddenKinds, search }),
    [tasks, owner, me, hiddenKinds, search]
  );
  const groups = React.useMemo(
    () => groupTasks(visible, todayIso),
    [visible, todayIso]
  );
  const closed = React.useMemo(() => closedTasks(visible), [visible]);
  // As mesmas linhas que o painel desenha, na mesma ordem.
  const ownerOptions = React.useMemo(
    () => [
      { value: 'mine', label: t('ownerMine') },
      { value: 'all', label: t('ownerAll') },
      ...[...members.values()].map((m) => ({
        value: m.user_id,
        label: m.full_name,
      })),
    ],
    [t, members]
  );

  const counts = React.useMemo(
    () => summarize(visible, todayIso),
    [visible, todayIso]
  );

  async function toggle(task: Task) {
    setBusy(task.id);
    const db = createClient();
    const ok =
      task.status === 'done'
        ? await reopenTask(db, task.id)
        : await completeTask(db, task.id);
    setBusy(null);
    if (!ok) {
      toast.error(tk('saveFailed'));
      return;
    }
    void publishTask(task.id);
    void notifyTaskCompleted(task.id);
    await load();
  }

  /**
   * Arrastar entre colunas do quadro.
   *
   * Cada destino tem a sua mutação — não é um `update` genérico de
   * `status` — porque cada uma carimba um campo diferente: concluir grava
   * `completed_at`, cancelar não. Um update cru deixaria a tarefa concluída
   * sem data de conclusão, e ela sumiria dos relatórios que contam por
   * período.
   */
  async function changeStatus(task: Task, status: TaskStatus) {
    setBusy(task.id);
    const db = createClient();
    const ok =
      status === 'done'
        ? await completeTask(db, task.id)
        : status === 'cancelled'
          ? await cancelTask(db, task.id)
          : await reopenTask(db, task.id);
    setBusy(null);
    if (!ok) {
      toast.error(tk('saveFailed'));
      return;
    }
    void publishTask(task.id);
    void notifyTaskCompleted(task.id);
    await load();
  }

  function toggleKind(kind: string) {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function closeDialog() {
    setEditing(null);
    setCreating(false);
    if (openTaskId) {
      const next = new URLSearchParams(params.toString());
      next.delete('task');
      router.replace(`/tasks${next.size ? `?${next}` : ''}`, { scroll: false });
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground text-xs">
            {counts.overdue > 0
              ? t('summaryOverdue', {
                  overdue: counts.overdue,
                  today: counts.today,
                })
              : t('summary', { open: counts.open, today: counts.today })}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="border-input bg-background h-8 w-44 rounded-md border pr-2 pl-7 text-xs"
            />
          </div>

          {/*
            As partes do `Select` e não o `OptionSelect`: aqui cada linha
            leva a FOTO do colega, e o atalho só aceita `<option>` de texto.
            A foto não é enfeite — numa equipe, reconhecer quem é pelo rosto
            é mais rápido do que ler o nome, e é o mesmo avatar que a caixa
            de entrada e a sala da equipe já desenham.
          */}
          {/*
            O `Select` pode devolver `null` quando a escolha é limpa. Aqui
            isso não deve virar filtro nenhum: cair em "Minhas" é o padrão
            da tela e o único estado que responde à pergunta que ela faz.
          */}
          <Select
            value={owner}
            onValueChange={(next) => setOwner(next ?? 'mine')}
            // `items` é o que o `<SelectValue>` lê para traduzir o valor
            // guardado de volta no rótulo. Sem ele o campo FECHADO mostra
            // o valor cru — "mine" no lugar de "Minhas" — enquanto a lista
            // aberta continua certa, que é o jeito mais confuso de errar.
            items={ownerOptions}
          >
            <SelectTrigger
              className="h-8 w-auto min-w-36 text-xs"
              aria-label={t('ownerLabel')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">{t('ownerMine')}</SelectItem>
              <SelectItem value="all">{t('ownerAll')}</SelectItem>
              {[...members.values()].map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  <span className="flex items-center gap-2">
                    <MemberAvatar
                      name={m.full_name}
                      avatarUrl={m.avatar_url}
                      size="2xs"
                    />
                    {m.full_name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/*
            Lista ou calendário — a mesma tarefa, duas perguntas. A lista
            responde "o que eu tenho para fazer", em ordem de urgência; o
            calendário responde "como está a minha semana". Uma lista não
            mostra que a quinta está livre, e um calendário não mostra sete
            atrasadas sem espalhá-las por sete dias passados.
          */}
          <div className="bg-muted flex rounded-md p-0.5">
            {(['list', 'board', 'calendar'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                aria-pressed={mode === option}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium',
                  mode === option
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground'
                )}
              >
                {t(`mode.${option}`)}
              </button>
            ))}
          </div>

          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t('new')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {TASK_KINDS.map((kind) => {
          const on = !hiddenKinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleKind(kind)}
              aria-pressed={on}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs',
                on ? 'bg-background' : 'text-muted-foreground opacity-60'
              )}
            >
              {tk(`kind.${kind}`)}
            </button>
          );
        })}
      </div>

      {tasks === null ? (
        <p className="text-muted-foreground p-8 text-sm">{t('loading')}</p>
      ) : mode === 'board' ? (
        <TasksBoard
          tasks={visible}
          todayIso={todayIso}
          onChangeStatus={changeStatus}
          onOpen={setEditing}
        />
      ) : mode === 'calendar' ? (
        <TasksCalendar tasks={visible} onSelectTask={setEditing} />
      ) : groups.length === 0 && closed.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <ListChecks className="text-muted-foreground size-6" />
          <p className="text-sm font-medium">{t('empty')}</p>
          <p className="text-muted-foreground text-xs">{t('emptyHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.bucket} className="space-y-1.5">
              <h2
                className={cn(
                  'text-2xs font-semibold tracking-wide uppercase',
                  group.bucket === 'overdue'
                    ? 'text-danger-ink'
                    : 'text-muted-foreground'
                )}
              >
                {t(`bucket.${group.bucket}`)}
                <span className="ml-1.5 font-normal opacity-70">
                  {group.tasks.length}
                </span>
              </h2>
              <ul className="divide-y rounded-lg border">
                {group.tasks.map((task) => (
                  <Row
                    key={task.id}
                    task={task}
                    bucket={group.bucket}
                    busy={busy === task.id}
                    onToggle={() => toggle(task)}
                    onOpen={() => setEditing(task)}
                    memberName={
                      task.assigned_to
                        ? (members.get(task.assigned_to)?.full_name ?? null)
                        : null
                    }
                    dueLabel={dueLabel(task, format)}
                    kindLabel={tk(`kind.${task.kind}`)}
                  />
                ))}
              </ul>
            </section>
          ))}

          {closed.length > 0 ? (
            <section className="space-y-1.5">
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                className="text-muted-foreground text-2xs flex items-center gap-1 font-semibold tracking-wide uppercase"
              >
                <ChevronDown
                  className={cn('size-3 transition', !showClosed && '-rotate-90')}
                />
                {t('bucket.closed')}
                <span className="font-normal opacity-70">{closed.length}</span>
              </button>
              {showClosed ? (
                <ul className="divide-y rounded-lg border">
                  {closed.map((task) => (
                    <Row
                      key={task.id}
                      task={task}
                      bucket="someday"
                      busy={busy === task.id}
                      onToggle={() => toggle(task)}
                      onOpen={() => setEditing(task)}
                      memberName={
                        task.assigned_to
                          ? (members.get(task.assigned_to)?.full_name ?? null)
                          : null
                      }
                      dueLabel={dueLabel(task, format)}
                      kindLabel={tk(`kind.${task.kind}`)}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      <TaskDialog
        open={Boolean(editing) || creating}
        onOpenChange={(next) => {
          if (!next) closeDialog();
        }}
        task={editing}
        onSaved={() => {
          closeDialog();
          void load();
        }}
      />
    </div>
  );
}

function Row({
  task,
  bucket,
  busy,
  onToggle,
  onOpen,
  memberName,
  dueLabel: due,
  kindLabel,
}: {
  task: Task;
  bucket: TaskBucket;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  memberName: string | null;
  dueLabel: string | null;
  kindLabel: string;
}) {
  const done = task.status !== 'open';

  return (
    <li className="hover:bg-muted/40 flex items-center gap-3 px-3 py-2">
      {/*
        A caixa de concluir é um botão de verdade e fica FORA do alvo que
        abre a gaveta. Aninhar os dois faria cada tentativa de marcar como
        feita abrir o diálogo por engano — o erro mais irritante que uma
        lista de tarefas pode ter, porque acontece na ação mais frequente.
      */}
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={done ? 'reopen' : 'complete'}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border transition',
          done
            ? 'bg-human-strong border-transparent text-white'
            : 'hover:border-human border-muted-foreground/40'
        )}
      >
        {done ? <Check className="size-3" /> : null}
        {busy ? <RotateCcw className="size-3 animate-spin" /> : null}
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn(
            'block truncate text-sm',
            done && 'text-muted-foreground line-through'
          )}
        >
          {task.title}
        </span>
        <span className="text-muted-foreground text-2xs flex flex-wrap items-center gap-x-2">
          <span>{kindLabel}</span>
          {due ? (
            <span
              className={cn(
                bucket === 'overdue' && !done && 'text-danger-ink font-medium'
              )}
            >
              {due}
            </span>
          ) : null}
          {memberName ? (
            <span className="inline-flex items-center gap-1">
              <UserIcon className="size-3" />
              {memberName}
            </span>
          ) : null}
        </span>
      </button>

      {task.contact_id ? (
        <Link
          href={`/contacts?id=${task.contact_id}`}
          className="text-muted-foreground hover:text-foreground text-2xs shrink-0 underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          contato
        </Link>
      ) : null}
    </li>
  );
}

/** `10 de set` ou `10 de set, 14:30`. Sem prazo devolve null. */
function dueLabel(
  task: Task,
  format: ReturnType<typeof useFormatter>
): string | null {
  if (!task.due_on) return null;
  const date = fromISO(task.due_on);
  if (!date) return null;
  const day = format.dateTime(date, { day: 'numeric', month: 'short' });
  return task.due_time ? `${day}, ${task.due_time.slice(0, 5)}` : day;
}
