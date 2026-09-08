'use client';

import * as React from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
import { StatusBadge } from '@/components/ui/status-badge';
import { BoardLane } from '@/components/pipelines/board-lane';
import { formatDue } from '@/components/tasks/task-row';
import { StatePanel } from '@/components/ui/state-panel';
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
/**
 * A bolinha do cabeçalho de cada coluna.
 *
 * Era uma régua de 2px rente ao topo da raia. As nove referências fazem
 * isto com uma bolinha ao lado do nome, sem exceção, e por um motivo: a
 * régua respondia à mesma pergunta — "em que coluna eu estou" — e cobrava
 * uma banda inteira por ela, além de prender a cor no canto mais distante
 * do nome que ela qualifica.
 */
const STATUS_DOT: Record<TaskStatus, string> = {
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
    // A MESMA RAIA DO FUNIL, literalmente. Os dois quadros divergiram uma vez
    // (foi o que abriu este redesenho) e a única forma de não divergirem de
    // novo é não existirem duas colunas.
    <BoardLane
      colorClass={STATUS_DOT[status]}
      name={tPage(`status.${status}`)}
      count={tasks.length}
      isOver={isOver}
      bodyRef={setNodeRef}
      footer={
        // Só na coluna das abertas: criar uma tarefa já concluída não é uma
        // ação que exista, e um botão que produz um estado impossível é pior
        // que a ausência dele.
        status === 'open' ? (
          <button
            type="button"
            onClick={onCreate}
            className="border-input text-muted-foreground hover:border-primary/40 hover:text-foreground mx-2 mb-2 flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-dashed text-xs font-medium transition-colors duration-(--dur-1)"
          >
            <Plus className="size-3.5" />
            {tPage('new')}
          </button>
        ) : null
      }
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

        {tasks.length === 0 && status !== 'open' ? (
          // O frame único de vazio da casa, o mesmo que o funil usa para
          // "solte uma oportunidade aqui". Um parágrafo cru à esquerda não
          // parecia um alvo de soltura.
          <StatePanel
            title={tPage('columnEmpty')}
            framed
            size="sm"
            className="flex-1"
          />
        ) : null}
    </BoardLane>
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
  const locale = useLocale();
  const members = useMemberDirectory();

  const overdue =
    task.status === 'open' && bucketOf(task, todayIso) === 'overdue';
  const due = task.due_on ? formatDue(task, todayIso, locale, tTask) : null;
  const owner = task.assigned_to ? members.get(task.assigned_to) : undefined;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        // A MESMA SUPERFÍCIE DO CARTÃO DO FUNIL: sombra em vez de borda, o
        // raio da casa e respiro de verdade. A borda continua no DOM,
        // transparente, porque é o canal que o `surface-interactive`
        // esquenta no ponteiro.
        'bg-card w-full cursor-grab rounded-xl border border-transparent p-3.5 text-left pointer-coarse:pr-10',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        isOverlay
          ? 'cursor-grabbing shadow-lg'
          : 'surface-interactive shadow-(--card-shadow)',
        busy && 'opacity-60'
      )}
    >
      {/* Aqui NÃO existe caixa de concluir, e isso é decidido: no quadro a
          COLUNA é o estado, então marcar a caixa e arrastar para "Concluída"
          seriam duas maneiras de dizer a mesma coisa — e no toque a caixa
          disputaria o alvo com a alça de arrasto. O resto do desenho é o
          mesmo da linha: o mesmo risco, a mesma pílula, a mesma foto. */}
      <span
        className={cn(
          'text-foreground block text-sm leading-tight font-semibold',
          task.status !== 'open' && 'text-muted-foreground line-through'
        )}
      >
        {task.title}
      </span>

      <span className="border-muted mt-3 flex items-center gap-1.5 border-t pt-2.5">
        <span className="text-muted-foreground text-2xs">
          {tTask(`kind.${task.kind}`)}
        </span>

        {/* O mesmo prazo que a linha da lista imprime, pela mesma função:
            a hora respeita o relógio do idioma em vez de sair sempre em 24h,
            e "Atrasada" é a MESMA pílula, não uma escrita à mão sem altura. */}
        {due ? (
          overdue ? (
            <StatusBadge variant="danger" size="sm">
              {due}
            </StatusBadge>
          ) : (
            <span className="text-muted-foreground text-2xs tabular-nums">
              {due}
            </span>
          )
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
