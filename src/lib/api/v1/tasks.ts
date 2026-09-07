import type { SupabaseClient } from '@supabase/supabase-js';

import { TASK_KINDS, type Task } from '@/types';

/**
 * As tarefas na API pública.
 *
 * ------------------------------------------------------------------
 * O QUE SAI, E O QUE NÃO SAI
 * ------------------------------------------------------------------
 *
 * `due_on` e `due_time` saem SEPARADOS, como estão na 068 — e não fundidos
 * num timestamp de conveniência. Fundi-los obrigaria a escolher um fuso na
 * saída e a adivinhar, na entrada, se `2026-09-07T00:00:00` era "o dia 7"
 * ou "as zero horas do dia 7". A ausência de hora É informação, e um
 * contrato que não sabe expressá-la força cada integração a inventar a
 * própria convenção.
 *
 * `reminded_at` não sai: é estado interno da varredura de lembretes, e
 * publicá-lo criaria a expectativa de que alguém pode escrevê-lo.
 */

export const TASK_SELECT =
  'id, title, description, kind, status, due_on, due_time, ' +
  'duration_minutes, remind_minutes_before, assigned_to, created_by, ' +
  'contact_id, deal_id, conversation_id, completed_at, completion_note, ' +
  'created_at, updated_at';

export interface SerializedTask {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  due_on: string | null;
  due_time: string | null;
  duration_minutes: number | null;
  remind_minutes_before: number | null;
  assigned_to: string | null;
  created_by: string | null;
  contact_id: string | null;
  deal_id: string | null;
  conversation_id: string | null;
  completed_at: string | null;
  completion_note: string | null;
  created_at: string;
  updated_at: string;
}

export function serializeTask(row: Task): SerializedTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    kind: row.kind,
    status: row.status,
    due_on: row.due_on ?? null,
    // `TIME` volta do Postgres como `14:30:00`; o contrato publica `HH:MM`,
    // que é o que a coluna significa e o que a tela mostra.
    due_time: row.due_time ? row.due_time.slice(0, 5) : null,
    duration_minutes: row.duration_minutes ?? null,
    remind_minutes_before: row.remind_minutes_before ?? null,
    assigned_to: row.assigned_to ?? null,
    created_by: row.created_by ?? null,
    contact_id: row.contact_id ?? null,
    deal_id: row.deal_id ?? null,
    conversation_id: row.conversation_id ?? null,
    completed_at: row.completed_at ?? null,
    completion_note: row.completion_note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class TaskApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const STATUSES = new Set(['open', 'done', 'cancelled']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Valida o corpo de um POST/PATCH.
 *
 * `due_time` sem `due_on` é recusado, e não silenciosamente ignorado: "as
 * 14h" sem dia não é um prazo, e aceitar isso gravaria uma hora que nunca
 * chega — a varredura de lembretes procura por `due_on`.
 */
export function validateTaskInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean }
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (!partial || 'title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw new TaskApiError('invalid_title', 'title is required');
    }
    patch.title = title;
  }

  if ('description' in body) {
    patch.description =
      typeof body.description === 'string' ? body.description.trim() : null;
  }

  if ('kind' in body) {
    const kind = String(body.kind);
    if (!(TASK_KINDS as readonly string[]).includes(kind)) {
      throw new TaskApiError(
        'invalid_kind',
        `kind must be one of: ${TASK_KINDS.join(', ')}`
      );
    }
    patch.kind = kind;
  }

  if ('status' in body) {
    const status = String(body.status);
    if (!STATUSES.has(status)) {
      throw new TaskApiError(
        'invalid_status',
        'status must be open, done or cancelled'
      );
    }
    patch.status = status;
    // Concluir pela API carimba o mesmo campo que a tela carimba. Sem
    // isto, uma tarefa fechada por integração ficaria sem data de
    // conclusão e sumiria dos relatórios que contam por período.
    patch.completed_at = status === 'done' ? new Date().toISOString() : null;
  }

  if ('due_on' in body) {
    if (body.due_on === null) {
      patch.due_on = null;
      patch.due_time = null;
    } else {
      const due = String(body.due_on);
      if (!DATE.test(due)) {
        throw new TaskApiError('invalid_due_on', 'due_on must be YYYY-MM-DD');
      }
      patch.due_on = due;
    }
  }

  if ('due_time' in body && body.due_time !== null) {
    const time = String(body.due_time);
    if (!TIME.test(time)) {
      throw new TaskApiError('invalid_due_time', 'due_time must be HH:MM');
    }
    const dueOn = patch.due_on ?? body.due_on;
    if (!dueOn) {
      throw new TaskApiError(
        'due_time_without_due_on',
        'due_time requires due_on'
      );
    }
    patch.due_time = time;
  } else if (body.due_time === null) {
    patch.due_time = null;
  }

  for (const key of ['assigned_to', 'contact_id', 'deal_id'] as const) {
    if (key in body) {
      patch[key] = body[key] === null ? null : String(body[key]);
    }
  }

  if ('remind_minutes_before' in body) {
    patch.remind_minutes_before =
      body.remind_minutes_before === null
        ? null
        : Number(body.remind_minutes_before);
  }

  if (Object.keys(patch).length === 0) {
    throw new TaskApiError('empty_patch', 'nothing to update');
  }

  return patch;
}

/**
 * O contato existe e é desta conta?
 *
 * A rota escreve com o cliente da chave de API, que é scoped por conta —
 * mas `contact_id` vem do corpo, e uma FK que aponta para outra conta
 * gravaria uma tarefa visível aqui e ligada a um cliente de lá.
 */
export async function assertContactOwned(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<void> {
  const { data } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (!data) {
    throw new TaskApiError('contact_not_found', 'contact_id not found', 404);
  }
}
