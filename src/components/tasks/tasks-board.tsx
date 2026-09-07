'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { GripVertical, User as UserIcon } from 'lucide-react';

import { useMemberDirectory } from '@/hooks/use-member-directory';
import { fromISO } from '@/lib/calendar';
import { bucketOf } from '@/lib/tasks/board';
import { TASK_STATUSES, type Task, type TaskStatus } from '@/types';
import { cn } from '@/lib/utils';

/**
 * O quadro de tarefas, por status.
 *
 * ------------------------------------------------------------------
 * TRÊS COLUNAS, E ARRASTAR MUDA O ESTADO
 * ------------------------------------------------------------------
 *
 * Aberta · Concluída · Cancelada. É o recorte que o Gabriel escolheu
 * quando a alternativa era agrupar por urgência.
 *
 * A diferença entre os dois não é estética: por urgência, arrastar
 * REAGENDA — de "Hoje" para "Semana" muda o prazo. Por status, arrastar
 * CONCLUI ou CANCELA. O quadro por status responde "em que pé está cada
 * coisa"; a lista, que agrupa por urgência, responde "o que eu faço
 * agora". As duas visões da mesma tela não repetem a mesma resposta.
 *
 * ------------------------------------------------------------------
 * O PRAZO CONTINUA VISÍVEL, E VERMELHO QUANDO VENCEU
 * ------------------------------------------------------------------
 *
 * Uma coluna "Aberta" ordenada por qualquer coisa que não seja urgência
 * esconde o que está atrasado no meio do que não está. O cartão carrega o
 * prazo e o pinta quando venceu — é a informação que o agrupamento por
 * status deixa de dar, devolvida onde ela ainda cabe.
 */
export function TasksBoard({
  tasks,
  todayIso,
  onChangeStatus,
  onOpen,
}: {
  tasks: Task[];
  todayIso: string;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onOpen: (task: Task) => void;
}) {
  const t = useTranslations('TasksPage');

  const sensors = useSensors(
    // 5px para que um clique não vire arrasto — o mesmo do quadro do funil.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const columns = React.useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(
      TASK_STATUSES.map((status) => [status, [] as Task[]])
    );
    for (const task of tasks) map.get(task.status)?.push(task);
    // Dentro da coluna, o mais urgente primeiro. Sem prazo vai para o fim:
    // uma tarefa sem data não compete por atenção com uma que venceu.
    for (const list of map.values()) {
      list.sort((a, b) =>
        (a.due_on ?? '9999-12-31').localeCompare(b.due_on ?? '9999-12-31')
      );
    }
    return map;
  }, [tasks]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const task = tasks.find((x) => x.id === String(active.id));
    const target = String(over.id) as TaskStatus;
    if (!task || task.status === target) return;
    if (!TASK_STATUSES.includes(target)) return;

    onChangeStatus(task, target);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            label={t(`status.${status}`)}
            tasks={columns.get(status) ?? []}
            todayIso={todayIso}
            onOpen={onOpen}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({
  status,
  label,
  tasks,
  todayIso,
  onOpen,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  todayIso: string;
  onOpen: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex min-h-40 flex-col gap-2 rounded-lg border p-2 transition-colors',
        isOver && 'border-primary bg-primary-soft/30'
      )}
    >
      <h2 className="text-muted-foreground text-2xs flex items-center gap-1.5 px-1 font-semibold tracking-wide uppercase">
        {label}
        <span className="font-normal opacity-70">{tasks.length}</span>
      </h2>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground/60 px-1 py-4 text-center text-xs">
          —
        </p>
      ) : (
        tasks.map((task) => (
          <Card
            key={task.id}
            task={task}
            todayIso={todayIso}
            onOpen={() => onOpen(task)}
          />
        ))
      )}
    </section>
  );
}

function Card({
  task,
  todayIso,
  onOpen,
}: {
  task: Task;
  todayIso: string;
  onOpen: () => void;
}) {
  const t = useTranslations('Tasks');
  const tb = useTranslations('TasksPage');
  const format = useFormatter();
  const members = useMemberDirectory();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });

  const overdue = task.status === 'open' && bucketOf(task, todayIso) === 'overdue';
  const due = task.due_on ? fromISO(task.due_on) : null;
  const owner = task.assigned_to ? members.get(task.assigned_to) : undefined;

  return (
    <article
      ref={setNodeRef}
      className={cn(
        'bg-card flex items-start gap-1.5 rounded-md border p-2',
        isDragging && 'opacity-50'
      )}
    >
      {/*
        A alça é a única superfície que arrasta, e o corpo do cartão abre a
        tarefa. Fazer o cartão inteiro arrastável tiraria dele o clique —
        que é a ação mais frequente — e no toque brigaria com a rolagem.
      */}
      <button
        type="button"
        className="text-muted-foreground/60 hover:text-foreground mt-0.5 cursor-grab touch-none"
        aria-label={tb('dragHandle')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            'block truncate text-sm',
            task.status !== 'open' && 'text-muted-foreground line-through'
          )}
        >
          {task.title}
        </span>
        <span className="text-muted-foreground text-2xs flex flex-wrap items-center gap-x-2">
          <span>{t(`kind.${task.kind}`)}</span>
          {due ? (
            <span className={cn(overdue && 'text-danger-ink font-medium')}>
              {format.dateTime(due, { day: 'numeric', month: 'short' })}
            </span>
          ) : null}
          {owner ? (
            <span className="inline-flex items-center gap-1">
              <UserIcon className="size-3" />
              {owner.full_name}
            </span>
          ) : null}
        </span>
      </button>
    </article>
  );
}
