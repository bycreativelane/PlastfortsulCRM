import type { AgendaItem } from '@/lib/dashboard/agenda';
import type { Task } from '@/types';

/**
 * Uma tarefa como linha de agenda.
 *
 * Existe para que a visão de calendário de `/tasks` e a agenda completa
 * desenhem a MESMA linha. Antes o mapeamento vivia dentro de
 * `lib/dashboard/agenda.ts`, invisível para quem já tem as tarefas em mãos —
 * e a tela de Tarefas tem: ela carrega `Task[]` inteiras, com título, tipo,
 * responsável e desfecho.
 *
 * Sem isto haveria dois mapeamentos para a mesma coisa, e o modo de falha é
 * o silencioso: uma tarefa que aparece de um jeito na agenda e de outro no
 * calendário das tarefas, sem nada quebrar.
 */
export function taskToAgendaItem(
  task: Task,
  /** Para onde o clique leva. A tela de Tarefas abre a gaveta local. */
  hrefBase: '/agenda' | '/tasks' = '/agenda'
): AgendaItem | null {
  if (!task.due_on) return null;

  return {
    id: `task:${task.id}`,
    kind: 'task',
    day: task.due_on,
    // Já é hora de parede no fuso da conta: uma coluna TIME não passa por
    // fuso nenhum.
    time: task.due_time ? task.due_time.slice(0, 5) : null,
    title: task.title,
    contact: null,
    value: null,
    currency: null,
    // O TIPO da tarefa ocupa o campo de status, como sempre ocupou — é o
    // que a linha mostra como segunda informação.
    status: task.kind,
    href: `${hrefBase}?task=${task.id}`,
    owner: task.assigned_to ?? null,
    reschedule: 'task',
    rowId: task.id,
  };
}

/** As que têm prazo, como linhas. As sem prazo não cabem num calendário. */
export function tasksAsAgendaItems(
  tasks: Task[],
  hrefBase: '/agenda' | '/tasks' = '/agenda'
): AgendaItem[] {
  return tasks.flatMap((task) => {
    const item = taskToAgendaItem(task, hrefBase);
    return item ? [item] : [];
  });
}
