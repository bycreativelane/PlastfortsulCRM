import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

import {
  GoogleApiError,
  listEvents,
  type EventsPage,
} from './client';
import {
  expiresAt,
  googleOAuthConfig,
  isExpired,
  refreshAccessToken,
} from './oauth';
import { normalizeEmail, toMirrorEvent, type MirrorEvent } from './map';

/**
 * Puxar a agenda da Google para o espelho.
 *
 * As cinco regras do §D5 do plano moram aqui e em `push.ts` (fase 5). As
 * três que este arquivo implementa:
 *
 * 1. **Evento vinculado não entra no espelho.** Senão a mesma tarefa
 *    aparece duas vezes na agenda — uma como tarefa e outra como evento
 *    importado — e a pessoa que a concluir vê a cópia continuar lá.
 * 3. **Apagar na Google não apaga a tarefa.** Aqui isso é a metade fácil:
 *    o evento sai do espelho; o vínculo é assunto da fase 5.
 * 5. **410 força reimportação completa.** É o comportamento documentado da
 *    própria API e a única forma de voltar a um estado consistente.
 */

/** A janela da primeira importação, em dias. §D6 do plano. */
const WINDOW_BACK_DAYS = 30;
const WINDOW_FORWARD_DAYS = 90;

/** Quantas páginas antes de parar. Uma agenda enorme não pode travar o cron. */
const MAX_PAGES = 20;

export interface ConnectionRow {
  id: string;
  account_id: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
}

export interface SourceRow {
  id: string;
  account_id: string;
  connection_id: string;
  external_id: string;
  sync_token: string | null;
}

export interface SyncResult {
  imported: number;
  removed: number;
  skipped: number;
  fullResync: boolean;
}

/**
 * Garante um access token vivo, renovando se preciso.
 *
 * O token novo é gravado cifrado ANTES de ser usado: se a chamada seguinte
 * falhar, o próximo tique reaproveita o token em vez de queimar outro
 * refresh. A Google limita refreshes por cliente, e um laço de erro que
 * renova a cada cinco minutos consome essa cota em silêncio.
 */
export async function ensureAccessToken(
  db: SupabaseClient,
  connection: ConnectionRow
): Promise<string> {
  if (connection.access_token && !isExpired(connection.access_expires_at)) {
    return decrypt(connection.access_token);
  }

  const config = googleOAuthConfig();
  if (!config) throw new Error('Google OAuth não configurado neste servidor');

  const refreshed = await refreshAccessToken(
    config,
    decrypt(connection.refresh_token)
  );

  const expires = expiresAt(refreshed.expires_in);
  await db
    .from('calendar_connections')
    .update({
      access_token: encrypt(refreshed.access_token),
      access_expires_at: expires,
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id);

  connection.access_token = encrypt(refreshed.access_token);
  connection.access_expires_at = expires;
  return refreshed.access_token;
}

function windowBounds(): { timeMin: string; timeMax: string } {
  const now = Date.now();
  return {
    timeMin: new Date(now - WINDOW_BACK_DAYS * 86_400_000).toISOString(),
    timeMax: new Date(now + WINDOW_FORWARD_DAYS * 86_400_000).toISOString(),
  };
}

/**
 * Importa uma fonte, página por página.
 *
 * Devolve as páginas percorridas e o `nextSyncToken` da última — a Google
 * só manda o token na página FINAL, e guardá-lo antes disso faria o próximo
 * tique pular o que ainda não foi lido.
 */
async function collect(
  accessToken: string,
  calendarId: string,
  syncToken: string | null
): Promise<{ items: EventsPage['items']; syncToken: string | null }> {
  const items: EventsPage['items'] = [];
  let pageToken: string | undefined;
  let nextSync: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const window = syncToken ? {} : windowBounds();
    const result: EventsPage = await listEvents(accessToken, calendarId, {
      syncToken,
      pageToken,
      ...window,
    });

    items.push(...result.items);
    nextSync = result.nextSyncToken ?? nextSync;
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }

  return { items, syncToken: nextSync };
}

/**
 * Sincroniza uma fonte e devolve o que mudou.
 *
 * Um 410 não é falha: é a Google dizendo que o `syncToken` envelheceu
 * demais. A resposta certa é jogar o token fora e reimportar a janela, uma
 * vez — e por isso a segunda tentativa entra com `syncToken` nulo em vez
 * de repetir a mesma chamada.
 */
export async function syncSource(
  db: SupabaseClient,
  connection: ConnectionRow,
  source: SourceRow
): Promise<SyncResult> {
  const accessToken = await ensureAccessToken(db, connection);

  let collected;
  let fullResync = false;
  try {
    collected = await collect(accessToken, source.external_id, source.sync_token);
  } catch (error) {
    if (error instanceof GoogleApiError && error.needsFullResync) {
      fullResync = true;
      collected = await collect(accessToken, source.external_id, null);
    } else {
      throw error;
    }
  }

  const outcome = await applyEvents(db, source, collected.items, fullResync);

  await db
    .from('calendar_sources')
    .update({
      sync_token: collected.syncToken ?? source.sync_token,
      last_synced_at: new Date().toISOString(),
      next_poll_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', source.id);

  return { ...outcome, fullResync };
}

/**
 * Grava o que veio, e apaga o que a Google diz ter sumido.
 *
 * Um evento `cancelled` no modo incremental É a notificação de exclusão —
 * é por isso que `listEvents` pede `showDeleted=true`. Sem tratar isso, o
 * espelho acumula para sempre o que já não existe.
 */
async function applyEvents(
  db: SupabaseClient,
  source: SourceRow,
  events: EventsPage['items'],
  fullResync: boolean
): Promise<{ imported: number; removed: number; skipped: number }> {
  const linked = await linkedExternalIds(db, source.account_id);

  const cancelled: string[] = [];
  const rows: Array<MirrorEvent & { account_id: string; source_id: string }> =
    [];
  let skipped = 0;

  for (const event of events) {
    const mirror = toMirrorEvent(event);
    if (!mirror) {
      skipped += 1;
      continue;
    }

    if (mirror.status === 'cancelled') {
      cancelled.push(mirror.external_id);
      continue;
    }

    // Regra 1: o que este CRM publicou não volta como evento importado.
    if (linked.has(mirror.external_id)) {
      skipped += 1;
      continue;
    }

    rows.push({
      ...mirror,
      account_id: source.account_id,
      source_id: source.id,
    });
  }

  const withContacts = await attachContacts(db, source.account_id, rows);

  if (withContacts.length > 0) {
    await db
      .from('calendar_events')
      .upsert(withContacts, { onConflict: 'source_id,external_id' });
  }

  if (cancelled.length > 0) {
    await db
      .from('calendar_events')
      .delete()
      .eq('source_id', source.id)
      .in('external_id', cancelled);
  }

  // Numa reimportação completa, o que não voltou não existe mais. Só vale
  // no modo completo: no incremental a lista é o DELTA, e apagar o que não
  // veio esvaziaria o espelho a cada tique.
  if (fullResync && withContacts.length > 0) {
    await db
      .from('calendar_events')
      .delete()
      .eq('source_id', source.id)
      .not(
        'external_id',
        'in',
        `(${withContacts.map((r) => `"${r.external_id}"`).join(',')})`
      );
  }

  return { imported: withContacts.length, removed: cancelled.length, skipped };
}

/** Os eventos que este CRM publicou — a regra 1 precisa saber quais são. */
async function linkedExternalIds(
  db: SupabaseClient,
  accountId: string
): Promise<Set<string>> {
  const { data } = await db
    .from('task_calendar_links')
    .select('external_id')
    .eq('account_id', accountId)
    .not('external_id', 'is', null);

  return new Set(
    ((data ?? []) as Array<{ external_id: string | null }>)
      .map((row) => row.external_id)
      .filter((id): id is string => Boolean(id))
  );
}

/**
 * Casa participante com contato, por e-mail.
 *
 * Uma consulta para todos os e-mails da leva, e não uma por evento: uma
 * importação completa traz centenas de eventos, e uma ida ao banco por
 * evento transformaria o tique de cinco minutos num que não termina.
 *
 * Nulo é o desfecho NORMAL — a maioria dos compromissos de uma empresa não
 * é com cliente cadastrado — então não há aviso nem erro quando não casa.
 */
async function attachContacts<T extends MirrorEvent>(
  db: SupabaseClient,
  accountId: string,
  rows: T[]
): Promise<Array<T & { contact_id: string | null }>> {
  const emails = [
    ...new Set(rows.flatMap((row) => row.attendee_emails)),
  ].filter(Boolean);

  if (emails.length === 0) {
    return rows.map((row) => ({ ...row, contact_id: null }));
  }

  const { data } = await db
    .from('contacts')
    .select('id, email')
    .eq('account_id', accountId)
    .in('email', emails);

  const byEmail = new Map<string, string>();
  for (const contact of (data ?? []) as Array<{
    id: string;
    email: string | null;
  }>) {
    const key = normalizeEmail(contact.email);
    if (key && !byEmail.has(key)) byEmail.set(key, contact.id);
  }

  return rows.map((row) => {
    const match = row.attendee_emails.find((email) => byEmail.has(email));
    return { ...row, contact_id: match ? (byEmail.get(match) ?? null) : null };
  });
}
