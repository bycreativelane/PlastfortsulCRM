import type { SupabaseClient } from '@supabase/supabase-js';

import type { Task } from '@/types';
import { toISO } from '@/lib/calendar';
import { minutesOf } from '@/lib/hours';

/**
 * Ler tarefas.
 *
 * Tudo sob RLS — a política `tasks_select` da 068 já limita à conta de quem
 * pergunta, e é por isso que não há filtro de `account_id` em nenhuma
 * consulta aqui. Um filtro a mais seria uma segunda regra de segurança
 * escrita num lugar onde ninguém a manteria.
 *
 * As funções puras no fim do arquivo são a parte que vale testar: o que
 * conta como atrasada, e em que ordem a lista aparece.
 */

/** Colunas que todo leitor precisa. Uma lista, para não divergirem. */
const COLUMNS =
  'id, account_id, title, description, kind, status, due_on, due_time, ' +
  'duration_minutes, remind_minutes_before, reminded_at, assigned_to, ' +
  'created_by, contact_id, deal_id, conversation_id, completed_at, ' +
  'completion_note, created_at, updated_at';

/** O que a agenda desenha: tarefas abertas com prazo dentro da janela. */
export async function loadTasksInRange(
  db: SupabaseClient,
  from: Date,
  to: Date
): Promise<Task[]> {
  const { data, error } = await db
    .from('tasks')
    .select(COLUMNS)
    .eq('status', 'open')
    .gte('due_on', toISO(from))
    .lte('due_on', toISO(to))
    .limit(300);

  if (error) return [];
  return (data ?? []) as unknown as Task[];
}

/**
 * As tarefas de um contato ou de uma oportunidade.
 *
 * Traz as concluídas junto, e essa é a decisão: "já ligamos na semana
 * passada" é precisamente o que se quer ler antes de ligar de novo. Quem
 * desenha separa por `status` — a consulta não decide isso pela tela.
 */
export async function loadTasksFor(
  db: SupabaseClient,
  target: { contactId?: string | null; dealId?: string | null }
): Promise<Task[]> {
  let query = db.from('tasks').select(COLUMNS);

  if (target.dealId) query = query.eq('deal_id', target.dealId);
  else if (target.contactId) query = query.eq('contact_id', target.contactId);
  // Sem alvo não há pergunta — devolver a conta inteira aqui seria uma
  // consulta cara disfarçada de engano de digitação.
  else return [];

  const { data, error } = await query.limit(100);
  if (error) return [];
  return sortTasks((data ?? []) as unknown as Task[]);
}

/**
 * Todas as tarefas da conta — o que a tela de Tarefas desenha.
 *
 * Traz as concluídas junto, e o limite é generoso porque a filtragem é do
 * lado do cliente: a tela tem busca por texto, filtro por tipo e por
 * responsável, e três dessas quatro coisas o PostgREST faria com uma ida ao
 * banco a cada tecla. Uma conta com mais de mil tarefas abertas tem um
 * problema que paginação não resolve.
 *
 * A RLS já limita à conta de quem pergunta — não há `account_id` aqui pela
 * mesma razão que não há em `loadTasksInRange`.
 */
export async function loadAllTasks(db: SupabaseClient): Promise<Task[]> {
  const { data, error } = await db
    .from('tasks')
    .select(COLUMNS)
    .order('due_on', { ascending: true, nullsFirst: false })
    .limit(1000);

  if (error) return [];
  return (data ?? []) as unknown as Task[];
}

/**
 * Uma tarefa, pelo id — o que o link `/agenda?task=<id>` precisa saber.
 *
 * Existe porque um link profundo chega SEM contexto: a pessoa veio de uma
 * notificação de lembrete, de um e-mail, ou de um endereço que ela mesma
 * guardou, e nenhuma dessas rotas passou pela lista de onde a tarefa
 * poderia ser lida. Procurar na janela já carregada da agenda quase
 * funciona, e o "quase" é o problema — uma tarefa de outro mês, ou uma já
 * concluída, não está lá, e o diálogo abriria vazio em vez de abrir.
 *
 * Devolve `null` em vez de erro: a tarefa pode ter sido excluída depois que
 * o link foi guardado, e isso é um desfecho normal, não uma falha.
 */
export async function loadTask(
  db: SupabaseClient,
  id: string
): Promise<Task | null> {
  const { data, error } = await db
    .from('tasks')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as Task;
}

// ------------------------------------------------------------
// A parte pura
// ------------------------------------------------------------

/**
 * Atrasada, e por que isso é derivado em vez de uma coluna.
 *
 * Uma coluna `is_overdue` precisaria de alguém para virá-la à meia-noite —
 * uma varredura diária, por conta, no fuso certo, que erra em silêncio
 * quando o cron para. A comparação é de duas strings ISO e responde certo
 * sem nada rodando.
 *
 * `todayIso` entra por parâmetro em vez de sair de `new Date()` porque o
 * "hoje" desta pergunta é o da CONTA (066), não o do navegador.
 */
export function isOverdue(task: Task, todayIso: string): boolean {
  if (task.status !== 'open' || !task.due_on) return false;
  return task.due_on < todayIso;
}

/** Vence hoje — o que a lista põe em destaque sem chamar de atraso. */
export function isDueToday(task: Task, todayIso: string): boolean {
  return task.status === 'open' && task.due_on === todayIso;
}

/**
 * A ordem da lista: por prazo, e dentro do dia as marcadas antes das soltas.
 *
 * Sem prazo vai para o fim — uma tarefa sem data não compete por atenção
 * com uma que tem. Concluídas e canceladas depois de tudo, porque a lista é
 * sobre o que falta; elas ficam para consulta, não para leitura.
 */
export function sortTasks(tasks: Task[]): Task[] {
  const rank = (t: Task) => (t.status === 'open' ? 0 : 1);

  return [...tasks].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);

    if (a.due_on !== b.due_on) {
      if (!a.due_on) return 1;
      if (!b.due_on) return -1;
      return a.due_on < b.due_on ? -1 : 1;
    }

    if (a.due_time !== b.due_time) {
      if (!a.due_time) return 1;
      if (!b.due_time) return -1;
      return minutesOf(a.due_time) - minutesOf(b.due_time);
    }

    return a.created_at < b.created_at ? -1 : 1;
  });
}

/** Só as abertas, na ordem — o que a maioria das telas quer. */
export function openTasks(tasks: Task[]): Task[] {
  return sortTasks(tasks.filter((t) => t.status === 'open'));
}

/** Quantas de cada, para o rótulo de um bloco fechado. */
export function countTasks(tasks: Task[], todayIso: string) {
  let open = 0;
  let overdue = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.status === 'done') done++;
    else if (task.status === 'open') {
      open++;
      if (isOverdue(task, todayIso)) overdue++;
    }
  }
  return { open, overdue, done, total: tasks.length };
}
