import { addDays, fromISO, toISO } from '@/lib/calendar';
import type { Task, TaskKind } from '@/types';

/**
 * As contas da tela de Tarefas.
 *
 * ------------------------------------------------------------------
 * POR QUE UMA TELA DE TAREFAS EXISTE, DEPOIS DE TER SIDO RECUSADA
 * ------------------------------------------------------------------
 *
 * O §C4 do `spec-tarefas-e-agendas.md` decidiu que tarefa não ganharia tela
 * própria: ela nasce dentro de uma conversa ou de uma oportunidade, e uma
 * lista fora de contexto vira uma segunda caixa de entrada que ninguém
 * abre. O argumento continua bom para quem trabalha DENTRO de um
 * atendimento.
 *
 * Ele erra para a outra pergunta, que é a que o Gabriel fez em 7 de
 * setembro de 2026: **"o que eu tenho para fazer?"** — sem cliente, sem
 * oportunidade, sem conversa. A agenda responde "o que tem quinta"; as
 * fichas respondem "o que tem com este cliente". Nenhuma das duas responde
 * a lista do próprio dia, que é justamente por onde alguém começa.
 *
 * Então são duas telas com dois recortes, e não duas portas para a mesma:
 * a agenda desenha o TEMPO, esta desenha a FILA.
 *
 * ------------------------------------------------------------------
 * O AGRUPAMENTO É POR URGÊNCIA, NÃO POR DATA
 * ------------------------------------------------------------------
 *
 * "Atrasadas" primeiro, e não em ordem cronológica junto com o resto. Uma
 * lista ordenada só por data enterra o que venceu na semana passada acima
 * do que vence hoje — visualmente correto e inútil, porque o que venceu é
 * exatamente o que precisa de decisão agora.
 */

/** As faixas da tela, na ordem em que são desenhadas. */
export const TASK_BUCKETS = [
  'overdue',
  'today',
  'tomorrow',
  'week',
  'later',
  'someday',
] as const;

export type TaskBucket = (typeof TASK_BUCKETS)[number];

/**
 * Em que faixa uma tarefa aberta cai.
 *
 * `todayIso` entra por parâmetro em vez de sair de `new Date()` porque o
 * "hoje" desta pergunta é o da CONTA (066), não o do navegador de quem
 * está olhando — a mesma razão de `isOverdue`.
 */
export function bucketOf(task: Task, todayIso: string): TaskBucket {
  if (!task.due_on) return 'someday';
  if (task.due_on < todayIso) return 'overdue';
  if (task.due_on === todayIso) return 'today';

  const today = fromISO(todayIso);
  if (!today) return 'later';

  if (task.due_on === toISO(addDays(today, 1))) return 'tomorrow';
  // Os sete dias seguintes, e não "até domingo": alguém que abre a tela na
  // sexta quer ver a semana que vem inteira, não dois dias.
  if (task.due_on <= toISO(addDays(today, 7))) return 'week';
  return 'later';
}

export interface TaskFilter {
  /** `'all'`, `'mine'`, ou um id de usuário do auth. */
  owner: 'all' | 'mine' | string;
  /** O id de quem está olhando. Null enquanto o perfil carrega. */
  me: string | null;
  /** Tipos DESMARCADOS. Vazio = mostra todos. */
  hiddenKinds: ReadonlySet<TaskKind | string>;
  /** Texto livre no título e nos detalhes. */
  search: string;
}

export function filterTasks(tasks: Task[], f: TaskFilter): Task[] {
  const needle = f.search.trim().toLowerCase();

  return tasks.filter((task) => {
    if (f.hiddenKinds.has(task.kind)) return false;

    if (f.owner !== 'all') {
      const wanted = f.owner === 'mine' ? f.me : f.owner;
      // Sem saber quem eu sou, "Minhas" não tem resposta. Mostrar tudo é o
      // lado certo de errar: esconder o trabalho de alguém porque o perfil
      // ainda não voltou é uma tela vazia que parece um dia livre.
      if (wanted && task.assigned_to !== wanted) return false;
    }

    if (needle) {
      const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

export interface TaskGroup {
  bucket: TaskBucket;
  tasks: Task[];
}

/**
 * As tarefas abertas, agrupadas e em ordem dentro de cada faixa.
 *
 * Faixas vazias saem do resultado: um cabeçalho "Amanhã" sobre o nada é
 * ruído que empurra o conteúdo real para baixo da dobra.
 */
export function groupTasks(tasks: Task[], todayIso: string): TaskGroup[] {
  const map = new Map<TaskBucket, Task[]>();

  for (const task of tasks) {
    if (task.status !== 'open') continue;
    const bucket = bucketOf(task, todayIso);
    const list = map.get(bucket);
    if (list) list.push(task);
    else map.set(bucket, [task]);
  }

  return TASK_BUCKETS.flatMap((bucket) => {
    const list = map.get(bucket);
    if (!list || list.length === 0) return [];
    return [{ bucket, tasks: list.sort(compareInBucket) }];
  });
}

/**
 * Dentro da faixa: prazo, depois hora, depois título.
 *
 * O título como terceiro critério não é enfeite — sem ele a ordem de duas
 * tarefas do mesmo dia e da mesma hora depende de como o banco as
 * devolveu, e a lista se reordena sozinha entre dois carregamentos.
 */
function compareInBucket(a: Task, b: Task): number {
  const dayA = a.due_on ?? '9999-12-31';
  const dayB = b.due_on ?? '9999-12-31';
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;

  const timeA = a.due_time ?? '99:99';
  const timeB = b.due_time ?? '99:99';
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;

  return a.title.localeCompare(b.title);
}

/** O que já saiu da fila — desenhado recolhido, no fim. */
export function closedTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((task) => task.status !== 'open')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
}

/** Os números do cabeçalho. */
export function summarize(tasks: Task[], todayIso: string) {
  let overdue = 0;
  let today = 0;
  let open = 0;

  for (const task of tasks) {
    if (task.status !== 'open') continue;
    open += 1;
    const bucket = bucketOf(task, todayIso);
    if (bucket === 'overdue') overdue += 1;
    else if (bucket === 'today') today += 1;
  }

  return { open, overdue, today };
}
