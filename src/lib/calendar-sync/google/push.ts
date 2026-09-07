import type { SupabaseClient } from '@supabase/supabase-js';

import type { Task } from '@/types';

import { deleteEvent, GoogleApiError, upsertEvent } from './client';
import { ensureAccessToken, type ConnectionRow } from './events';
import { eventIdForTask, taskToEvent } from './map';

/**
 * Levar a tarefa do CRM para a agenda da Google.
 *
 * ------------------------------------------------------------------
 * RECONCILIAR, E NÃO "ENVIAR"
 * ------------------------------------------------------------------
 *
 * Uma função só, chamada depois de qualquer mudança, que faz a Google
 * PARECER com a tarefa. Criar, mover, concluir e cancelar entram todos por
 * aqui, e o resultado depende do estado atual da tarefa e não do verbo que
 * a mudou.
 *
 * A alternativa — um `onCreate`, um `onUpdate`, um `onComplete` — precisa
 * que quem chama acerte qual é o caso, e erra em silêncio quando dois
 * acontecem juntos (concluir e reagendar no mesmo salvamento). Reconciliar
 * é idempotente por construção: chamar duas vezes é igual a chamar uma, e
 * chamar depois de uma falha é a própria recuperação.
 *
 * ------------------------------------------------------------------
 * AS REGRAS 3 E 4 DO §D5 MORAM AQUI
 * ------------------------------------------------------------------
 *
 * **Regra 4:** concluir NÃO apaga o evento — marca o título com `✓`. Quem
 * olha a semana passada quer ver que aquilo aconteceu, e uma agenda que se
 * esvazia conforme o trabalho é feito perde exatamente o registro que a
 * torna útil. Cancelar é o único caso em que o evento some, porque é o
 * único em que ele deixa de ser verdade.
 *
 * **Regra 3 (a metade daqui):** um evento apagado na Google deixa o vínculo
 * em `deleted` e a tarefa viva. Sumir com o compromisso do CRM porque
 * alguém limpou a agenda é perda de dado silenciosa.
 */

export interface LinkRow {
  id: string;
  task_id: string;
  source_id: string;
  external_id: string | null;
  etag: string | null;
  sync_state: 'pending' | 'synced' | 'error' | 'deleted';
}

export interface PushTarget {
  /** `calendar_sources.id` */
  sourceId: string;
  /** O `calendarId` da Google. */
  externalId: string;
}

export interface PushOutcome {
  pushed: number;
  deleted: number;
  failed: number;
}

/**
 * Põe a Google de acordo com a tarefa, em cada agenda de destino.
 *
 * `targets` já vem filtrado por `direction` (`out` ou `both`) e por
 * `enabled` — esta função não decide ONDE publicar, só publica.
 */
export async function reconcileTask(
  db: SupabaseClient,
  connection: ConnectionRow,
  task: Task,
  targets: PushTarget[]
): Promise<PushOutcome> {
  const outcome: PushOutcome = { pushed: 0, deleted: 0, failed: 0 };
  if (targets.length === 0) return outcome;

  const accessToken = await ensureAccessToken(db, connection);
  const eventId = eventIdForTask(task.id);

  // Cancelada, ou sem prazo, não tem lugar numa agenda. "Sem prazo" é o
  // caso silencioso: alguém limpa a data de uma tarefa já publicada, e o
  // evento continuaria lá marcando um dia que a tarefa já não reivindica.
  const shouldExist = task.status !== 'cancelled' && Boolean(task.due_on);

  for (const target of targets) {
    try {
      if (shouldExist) {
        await pushOne(db, accessToken, task, target, eventId);
        outcome.pushed += 1;
      } else {
        await removeOne(db, accessToken, task, target, eventId);
        outcome.deleted += 1;
      }
    } catch (error) {
      outcome.failed += 1;
      await markFailed(db, task, target, error);
    }
  }

  return outcome;
}

async function pushOne(
  db: SupabaseClient,
  accessToken: string,
  task: Task,
  target: PushTarget,
  eventId: string
): Promise<void> {
  const body = taskToEvent(task);
  if (!body) return;

  const event = await upsertEvent(
    accessToken,
    target.externalId,
    eventId,
    body
  );

  // O `etag` é gravado com o que ACABAMOS de escrever. A regra 2 compara
  // com o que volta da importação para decidir se foi a Google que mudou;
  // sem gravar aqui, a nossa própria escrita voltaria parecendo alheia e a
  // tarefa seria "movida" para onde ela já estava — um ricochete que se
  // repete a cada tique.
  await db.from('task_calendar_links').upsert(
    {
      account_id: task.account_id,
      task_id: task.id,
      source_id: target.sourceId,
      external_id: event.id ?? eventId,
      etag: event.etag ?? null,
      sync_state: 'synced',
      last_error: null,
      retry_after: null,
      pushed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'task_id,source_id' }
  );

}

async function removeOne(
  db: SupabaseClient,
  accessToken: string,
  task: Task,
  target: PushTarget,
  eventId: string
): Promise<void> {
  await deleteEvent(accessToken, target.externalId, eventId);

  await db
    .from('task_calendar_links')
    .update({
      sync_state: 'deleted',
      external_id: null,
      etag: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('task_id', task.id)
    .eq('source_id', target.sourceId);
}

/**
 * A caixa de saída: o que falhou fica `pending` com hora de voltar.
 *
 * Mesmo padrão da 065. O envio é síncrono porque é o que a pessoa espera
 * ver — o evento aparece na Google no momento em que ela salva — mas uma
 * rede que cai não pode custar o vínculo. O cron drena.
 *
 * Um erro permanente vira `error` e não `pending`: a diferença é que
 * `error` ainda é drenado (com recuo maior) mas a tela pode dizer que algo
 * precisa de atenção humana, em vez de mostrar "aguardando" para sempre.
 */
async function markFailed(
  db: SupabaseClient,
  task: Task,
  target: PushTarget,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const transient = error instanceof GoogleApiError && error.isTransient;

  await db.from('task_calendar_links').upsert(
    {
      account_id: task.account_id,
      task_id: task.id,
      source_id: target.sourceId,
      sync_state: transient ? 'pending' : 'error',
      last_error: message.slice(0, 500),
      retry_after: new Date(
        Date.now() + (transient ? 5 : 60) * 60_000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'task_id,source_id' }
  );

  console.error(`[calendar] envio da tarefa ${task.id} falhou:`, message);
}

/**
 * Regra 2 do §D5: mover na Google move a tarefa.
 *
 * Chamada pela IMPORTAÇÃO, com o evento que voltou. Só age quando o `etag`
 * mudou — igual significa que nada aconteceu desde a nossa escrita — e o
 * `etag` novo é gravado ANTES de qualquer envio, que é o que impede o
 * ricochete descrito em `pushOne`.
 *
 * Devolve `true` quando a tarefa foi movida, para que quem chama saiba que
 * não deve reenviá-la neste tique.
 */
export async function applyRemoteMove(
  db: SupabaseClient,
  link: LinkRow,
  event: {
    etag?: string | null;
    start_date?: string | null;
    starts_at?: string | null;
    all_day?: boolean;
    time?: string | null;
  }
): Promise<boolean> {
  if (!event.etag || event.etag === link.etag) return false;

  const patch: Record<string, unknown> = {
    etag: event.etag,
    updated_at: new Date().toISOString(),
  };

  // O etag primeiro, e num update próprio: se a escrita da tarefa falhar
  // logo abaixo, o pior caso é uma mudança perdida — não um laço.
  await db.from('task_calendar_links').update(patch).eq('id', link.id);

  const due = event.all_day ? event.start_date : dayOfIso(event.starts_at);
  if (!due) return false;

  await db
    .from('tasks')
    .update({
      due_on: due,
      due_time: event.all_day ? null : event.time,
      updated_at: new Date().toISOString(),
    })
    .eq('id', link.task_id);

  return true;
}

/** `2026-09-07T14:00:00-03:00` → `2026-09-07`, sem passar por fuso. */
function dayOfIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** As agendas que recebem publicação. */
export async function loadPushTargets(
  db: SupabaseClient,
  connectionId: string
): Promise<PushTarget[]> {
  const { data } = await db
    .from('calendar_sources')
    .select('id, external_id')
    .eq('connection_id', connectionId)
    .eq('enabled', true)
    .in('direction', ['out', 'both']);

  return ((data ?? []) as Array<{ id: string; external_id: string }>).map(
    (row) => ({ sourceId: row.id, externalId: row.external_id })
  );
}
