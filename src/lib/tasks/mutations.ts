import type { SupabaseClient } from '@supabase/supabase-js';

import type { Task, TaskStatus } from '@/types';
import {
  addBusinessDays,
  firstOpenTime,
  nextOpenSlot,
  type BusinessHours,
} from '@/lib/hours';

/**
 * Escrever tarefas.
 *
 * NADA AQUI APAGA por conclusão ou cancelamento. É a mesma regra que a fila
 * de automações (065) e as ocorrências (042) seguem, e que o cabeçalho da
 * 068 repete: uma tarefa cancelada não é uma tarefa que nunca existiu, e
 * "já decidimos não cobrar este" é exatamente o que alguém precisa saber
 * antes de cobrar. `deleteTask` existe para o engano de digitação, e a
 * política da 068 a reserva a quem criou (ou a um admin).
 */

export interface TaskInput {
  title: string;
  description?: string | null;
  kind?: string;
  due_on?: string | null;
  due_time?: string | null;
  duration_minutes?: number | null;
  remind_minutes_before?: number | null;
  assigned_to?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  conversation_id?: string | null;
}

/**
 * Limpa o que a 068 recusaria, antes de tentar.
 *
 * Hora sem dia e lembrete sem dia são CHECKs no banco. Deixar o INSERT
 * falhar seria correto e ilegível: a tela mostraria "violates check
 * constraint tasks_time_needs_day" para quem só tirou a data e esqueceu de
 * tirar a hora. Aqui a hora simplesmente cai junto, que é o que a pessoa
 * quis dizer.
 */
function coherent<T extends Partial<TaskInput>>(input: T): T {
  if (input.due_on === null || input.due_on === '') {
    return {
      ...input,
      due_on: null,
      due_time: null,
      remind_minutes_before: null,
    };
  }
  return input;
}

export async function createTask(
  db: SupabaseClient,
  accountId: string,
  createdBy: string | null,
  input: TaskInput
): Promise<Task | null> {
  const { data, error } = await db
    .from('tasks')
    .insert({
      account_id: accountId,
      created_by: createdBy,
      kind: 'todo',
      ...coherent(input),
    })
    .select()
    .maybeSingle();

  if (error) return null;
  return (data as unknown as Task) ?? null;
}

export async function updateTask(
  db: SupabaseClient,
  id: string,
  patch: Partial<TaskInput>
): Promise<boolean> {
  const { error } = await db
    .from('tasks')
    .update({ ...coherent(patch), updated_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}

/**
 * Concluir, e o carimbo que a 068 exige.
 *
 * `completed_at` não é opcional: o constraint `tasks_done_has_date` recusa
 * uma tarefa feita sem data, porque "feita" sem quando é a versão da linha
 * que não serve para nada depois.
 */
export async function completeTask(
  db: SupabaseClient,
  id: string,
  note?: string | null
): Promise<boolean> {
  const { error } = await db
    .from('tasks')
    .update({
      status: 'done' satisfies TaskStatus,
      completed_at: new Date().toISOString(),
      completion_note: note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  return !error;
}

/** Cancelar: some da lista do que falta, fica na história. */
export async function cancelTask(
  db: SupabaseClient,
  id: string,
  note?: string | null
): Promise<boolean> {
  const { error } = await db
    .from('tasks')
    .update({
      status: 'cancelled' satisfies TaskStatus,
      completion_note: note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  return !error;
}

/**
 * Reabrir — e limpar o carimbo, senão a linha fica dizendo que foi
 * concluída num dia em que voltou a estar aberta.
 */
export async function reopenTask(
  db: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await db
    .from('tasks')
    .update({
      status: 'open' satisfies TaskStatus,
      completed_at: null,
      completion_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  return !error;
}

/**
 * Mover o prazo — o que a agenda chama ao arrastar.
 *
 * `reminded_at` volta a NULL: uma tarefa remarcada para a semana que vem
 * tem de lembrar de novo, e sem isto o carimbo antigo silenciaria o
 * lembrete para sempre. É o mesmo raciocínio de `reopenTask` — o carimbo
 * descreve um envio que já não corresponde à linha.
 */
export async function rescheduleTask(
  db: SupabaseClient,
  id: string,
  iso: string | null
): Promise<boolean> {
  const patch = iso
    ? { due_on: iso, reminded_at: null }
    : // Sem data não há hora nem lembrete — ver `coherent`.
      { due_on: null, due_time: null, remind_minutes_before: null };

  const { error } = await db
    .from('tasks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}

/** Para o engano de digitação. A política da 068 decide quem pode. */
export async function deleteTask(
  db: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await db.from('tasks').delete().eq('id', id);
  return !error;
}

// ------------------------------------------------------------
// Os atalhos de prazo
// ------------------------------------------------------------

/**
 * "Hoje", "amanhã", "esta semana" — mas em horário comercial.
 *
 * É aqui que a Fase 1 paga. Sexta às 19h mais um dia é sábado às 00:00,
 * que é uma resposta que ninguém quis; a daqui é segunda às 08:00. Um
 * atalho que marca compromisso para quando a empresa está fechada é um
 * atalho que a pessoa vai ter de corrigir toda vez, e aí ela para de usar.
 */
export type DuePreset = 'today' | 'tomorrow' | 'in3days' | 'nextWeek';

export function presetDue(
  preset: DuePreset,
  hours: BusinessHours,
  todayIso: string,
  nowTime: string | null = null
): { due_on: string; due_time: string | null } {
  if (preset === 'today') {
    // Hoje mantém a hora só se ainda dá tempo; passado o expediente, "hoje"
    // vira o dia inteiro em vez de um horário que já foi.
    const slot = nextOpenSlot(hours, todayIso, nowTime);
    return slot?.day === todayIso
      ? { due_on: todayIso, due_time: slot.time }
      : { due_on: todayIso, due_time: null };
  }

  const days = preset === 'tomorrow' ? 1 : preset === 'in3days' ? 3 : 7;
  const day = addBusinessDays(hours, todayIso, days);
  return { due_on: day, due_time: firstOpenTime(hours, day) };
}
