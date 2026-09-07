'use client';

import * as React from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { GripVertical, Plus } from 'lucide-react';

import { useMemberDirectory } from '@/hooks/use-member-directory';
import { MemberAvatar } from '@/components/presence/member-avatar';
import { StatePanel } from '@/components/ui/state-panel';
import { fromISO } from '@/lib/calendar';
import { bucketOf } from '@/lib/tasks/board';
import { TASK_STATUSES, type Task, type TaskStatus } from '@/types';
import { cn } from '@/lib/utils';

/**
 * O quadro de tarefas, por status.
 *
 * ------------------------------------------------------------------
 * A COLUNA É UMA PISTA REBAIXADA, NÃO UM CARTÃO
 * ------------------------------------------------------------------
 *
 * É a mesma decisão que `pipeline-board.tsx` documenta, e a primeira versão
 * desta tela a violou: colunas com borda segurando cartões com borda. O
 * resultado é o que aquele comentário adverte — a pilha achata num retângulo
 * cinza e nada tem hierarquia.
 *
 * A coluna leva a superfície fosca (`bg-muted`) e os cartões levam o branco.
 * O contraste é o que faz o cartão parecer que está DENTRO de alguma coisa,
 * que é como ClickUp, Notion e Linear desenham a mesma ideia.
 *
 * ------------------------------------------------------------------
 * COLUNA TEM LARGURA, NÃO FRAÇÃO DA TELA
 * ------------------------------------------------------------------
 *
 * `grid-cols-3` esticava cada coluna a um terço do monitor: cartões de 500px
 * de largura com três palavras dentro. Um quadro tem colunas de largura
 * legível e rola de lado — no telefone a próxima espia na borda, o que é a
 * dica de que há mais.
 *
 * ------------------------------------------------------------------
 * E O CARTÃO INTEIRO ARRASTA, COM MOUSE
 * ------------------------------------------------------------------
 *
 * A alça aparece só no toque (`pointer-coarse`). Com mouse o cartão inteiro
 * já é a alça, e — de novo nas palavras do quadro do funil — "uma alça que
 * só é apontada é adorno". A primeira versão tinha a alça sempre visível e
 * como ÚNICA superfície de arrasto, o que é o pior dos dois mundos.
 */

/** A cor de cada coluna, como a etapa do funil tem a sua. */
const STATUS_RULE: Record<TaskStatus, string> = {
  open: 'bg-human',
  done: 'bg-ok',
  cancelled: 'bg-muted-foreground/40',
};

export function TasksBoard({
  tasks,
  todayIso,
  busyId,
  onChangeStatus,
  onOpen,
  onCreate,
}: {
  tasks: Task[];
  todayIso: string;
  /** A tarefa cuja mudança de estado ainda está no ar. */
  busyId: string | null;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onOpen: (task: Task) => void;
  onCreate: () => void;
}) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
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
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const task = tasks.find((x) => x.id === String(active.id));
    const target = String(over.id) as TaskStatus;
    if (!task || task.status === target) return;
    if (!TASK_STATUSES.includes(target)) return;

    onChangeStatus(task, target);
  }

  const activeTask = activeId
    ? (tasks.find((x) => x.id === activeId) ?? null)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* `min-h-0 flex-1`: o trilho toma a altura que sobra e rola de lado
          DENTRO dela. Sem isso as colunas cresciam para caber os cartões e
          quem rolava era a página — a única direção em que um quadro não
          pode rolar. */}
      <div className="board-scroll flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-3 overflow-x-auto pb-1 lg:snap-none">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={columns.get(status) ?? []}
            todayIso={todayIso}
            busyId={busyId}
            onOpen={onOpen}
            onCreate={onCreate}
          />
        ))}
      </div>

      {/*
        O clone que acompanha o ponteiro. Sem ele o arrasto era invisível:
        o cartão original desbotava e nada mais acontecia.

        180ms e `cubic-bezier(0.2, 0, 0, 1)` escritos à mão porque o dnd-kit
        recebe número e string, não variável CSS — são o `--dur-2` e o
        `--ease-out` da casa. Duração 2 porque algo se MOVEU.
      */}
      <DragOverlay
        dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}
      >
        {activeTask ? (
          <div className="opacity-90">
            <Card task={activeTask} todayIso={todayIso} onOpen={() => {}} isOverlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  tasks,
  todayIso,
  busyId,
  onOpen,
  onCreate,
}: {
  status: TaskStatus;
  tasks: Task[];
  todayIso: string;
  busyId: string | null;
  onOpen: (task: Task) => void;
  onCreate: () => void;
}) {
  const tPage = useTranslations('TasksPage');
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="bg-muted flex w-[85vw] max-w-[320px] min-w-[260px] shrink-0 snap-start flex-col overflow-hidden rounded-b-lg lg:w-auto lg:max-w-none lg:flex-1 lg:shrink lg:basis-[260px] lg:snap-none">
      {/* Uma régua de 2px, quadrada e rente ao topo. Orientação, não
          atenção — é o que deixa saber em que coluna se está sem ler o
          título, e mantê-la fina é o que impede virar sinal. */}
      <div className={cn('h-0.5 shrink-0', STATUS_RULE[status])} />

      <div className="shrink-0 px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-foreground min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
            {tPage(`status.${status}`)}
          </h3>
          <span className="bg-card text-secondary-foreground text-3xs shrink-0 rounded-full px-1.5 font-bold">
            {tasks.length}
          </span>
        </div>
      </div>

      {/* `overflow-y-auto`: a COLUNA rola, não a página. E o `ref` do
          droppable fica aqui e não na raiz, para que um arrasto sobre o
          cabeçalho não acenda a coluna inteira — mesma decisão do funil. */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors duration-(--dur-1)',
          isOver && 'bg-primary-soft'
        )}
      >
        {tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            todayIso={todayIso}
            busy={busyId === task.id}
            onOpen={() => onOpen(task)}
          />
        ))}

        {/* Só na coluna das abertas: criar uma tarefa já concluída não é
            uma ação que exista, e um botão que produz um estado impossível
            é pior que a ausência dele. */}
        {status === 'open' ? (
          <button
            type="button"
            onClick={onCreate}
            className="text-muted-foreground hover:bg-card hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors"
          >
            <Plus className="size-3.5" />
            {tPage('new')}
          </button>
        ) : tasks.length === 0 ? (
          // O frame único de vazio da casa, o mesmo que o funil usa para
          // "solte uma oportunidade aqui". Um parágrafo cru à esquerda não
          // parecia um alvo de soltura.
          <StatePanel title={tPage('columnEmpty')} framed size="sm" className="flex-1" />
        ) : null}
      </div>
    </div>
  );
}

function DraggableCard({
  task,
  todayIso,
  busy,
  onOpen,
}: {
  task: Task;
  todayIso: string;
  busy: boolean;
  onOpen: () => void;
}) {
  const tPage = useTranslations('TasksPage');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });

  // A mesma pressão, na alça em vez do cartão. `stopPropagation` evita que
  // o ouvinte do invólucro rode uma segunda vez para um dedo só.
  function startDragFromGrip(event: ReactPointerEvent) {
    event.stopPropagation();
    listeners?.onPointerDown?.(event);
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // `touch-manipulation` e não `touch-action: none`: os cartões cobrem a
      // coluna quase inteira, e proibir o arrasto de tela em cada um deixaria
      // o dedo sem como rolar nem a coluna nem o quadro.
      className="relative touch-manipulation"
      style={{ opacity: isDragging ? 0.3 : 1 }}
    >
      <Card task={task} todayIso={todayIso} busy={busy} onOpen={onOpen} />

      {/* A polegada quadrada do cartão que não rola. Só em ponteiro grosso:
          com mouse o cartão inteiro já é a alça. */}
      <button
        type="button"
        aria-label={tPage('dragHandle')}
        title={tPage('dragHandle')}
        onPointerDown={startDragFromGrip}
        className="text-muted-foreground/60 hover:text-muted-foreground absolute inset-y-0 right-0 hidden w-9 cursor-grab touch-none place-items-center rounded-r-lg active:cursor-grabbing pointer-coarse:grid"
      >
        <GripVertical className="size-4" />
      </button>
    </div>
  );
}

function Card({
  task,
  todayIso,
  busy = false,
  isOverlay = false,
  onOpen,
}: {
  task: Task;
  todayIso: string;
  busy?: boolean;
  /** O clone que segue o ponteiro: levantado, e sem hover nem foco. */
  isOverlay?: boolean;
  onOpen: () => void;
}) {
  const tTask = useTranslations('Tasks');
  const format = useFormatter();
  const members = useMemberDirectory();

  const overdue =
    task.status === 'open' && bucketOf(task, todayIso) === 'overdue';
  const due = task.due_on ? fromISO(task.due_on) : null;
  const owner = task.assigned_to ? members.get(task.assigned_to) : undefined;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        // `surface-interactive` é a receita única de hover da casa: a borda
        // esquenta, o cartão sobe 1px e o `:active` cancela o lift. Estava
        // escrita à mão aqui, sem o lift — que é justamente o que dá a
        // sensação de que o cartão é pegável.
        'border-border bg-card w-full cursor-grab rounded-lg border px-2.5 py-2.5 text-left pointer-coarse:pr-10',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        isOverlay ? 'cursor-grabbing shadow-lg' : 'surface-interactive',
        busy && 'opacity-60'
      )}
    >
      <span
        className={cn(
          'text-foreground block text-sm leading-tight font-semibold',
          task.status !== 'open' && 'text-muted-foreground line-through'
        )}
      >
        {task.title}
      </span>

      <span className="border-muted mt-2 flex items-center gap-1.5 border-t pt-1.5">
        <span className="text-muted-foreground text-2xs">
          {tTask(`kind.${task.kind}`)}
        </span>

        {due ? (
          <span
            className={cn(
              'text-2xs tabular-nums',
              overdue
                ? 'bg-danger-soft text-danger-ink rounded-full px-1.5 font-semibold'
                : 'text-muted-foreground'
            )}
          >
            {format.dateTime(due, { day: 'numeric', month: 'short' })}
            {task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''}
          </span>
        ) : null}

        {/* O rosto no fim da linha, como no cartão da oportunidade: numa
            equipe, reconhecer quem é pela foto é mais rápido que ler. */}
        {owner ? (
          <span className="ml-auto shrink-0">
            <MemberAvatar
              name={owner.full_name}
              avatarUrl={owner.avatar_url}
              size="2xs"
            />
          </span>
        ) : null}
      </span>
    </button>
  );
}
