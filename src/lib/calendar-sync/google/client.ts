import type { GoogleEvent } from './map';

/**
 * A Calendar API, e o significado de cada código que ela devolve.
 *
 * Este arquivo existe para que o resto da integração não precise saber o
 * que um 410 quer dizer. Os códigos da Google carregam instruções, não só
 * falhas, e tratá-los como "deu erro" é o que transforma uma reimportação
 * de rotina numa fonte permanentemente quebrada.
 *
 * | Código | O que significa de verdade                          |
 * | ------ | --------------------------------------------------- |
 * | 401    | Access token venceu. Renovar e repetir.             |
 * | 403    | Cota, ou escopo faltando. Só a mensagem distingue.  |
 * | 404    | O evento sumiu lá. Regra 3 do §D5: desvincula.      |
 * | 409    | O id determinístico já existe. Regra do §D4: PATCH. |
 * | 410    | `syncToken` velho. Regra 5: reimportação completa.  |
 */

const API = 'https://www.googleapis.com/calendar/v3';

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string
  ) {
    super(`Google Calendar ${status}: ${detail}`);
  }

  /** O token de sincronização morreu — reimportar a janela inteira. */
  get needsFullResync(): boolean {
    return this.status === 410;
  }

  /** O evento não existe mais do lado de lá. */
  get isGone(): boolean {
    return this.status === 404;
  }

  /** Já existe um evento com este id — o caminho é PATCH, não POST. */
  get alreadyExists(): boolean {
    return this.status === 409;
  }

  /** O access token venceu; renovar e repetir uma vez. */
  get isExpiredToken(): boolean {
    return this.status === 401;
  }

  /**
   * Vale a pena tentar de novo mais tarde.
   *
   * 429 e a família 5xx são transitórios. Um 403 NÃO entra aqui mesmo
   * quando é cota: distinguir "cota estourada" de "escopo faltando" exige
   * ler a mensagem, e repetir um escopo faltando para sempre é um laço
   * que nunca fecha.
   */
  get isTransient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

async function call<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = response.statusText || 'erro';
    try {
      const body = (await response.json()) as {
        error?: { message?: string };
      };
      if (body.error?.message) detail = body.error.message;
    } catch {
      /* resposta sem JSON: fica o statusText */
    }
    throw new GoogleApiError(response.status, detail);
  }

  // DELETE devolve 204 sem corpo.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface CalendarListEntry {
  id: string;
  summary?: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

/** As agendas que a conta autorizada enxerga. */
export async function listCalendars(
  accessToken: string
): Promise<CalendarListEntry[]> {
  const data = await call<{ items?: CalendarListEntry[] }>(
    accessToken,
    '/users/me/calendarList?maxResults=250'
  );
  return data.items ?? [];
}

export interface EventsPage {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/**
 * Uma página de eventos.
 *
 * Com `syncToken` a Google devolve só o que mudou desde a última vez — é a
 * diferença entre reimportar tudo a cada cinco minutos e pedir o delta. Na
 * primeira vez não há token, e aí vale a janela de −30 a +90 dias do §D6.
 *
 * `singleEvents=true` expande as recorrências em ocorrências. Sem isso, uma
 * reunião semanal chega como UMA linha com regra de repetição, e o espelho
 * teria que interpretar RRULE — que é um calendário inteiro escondido
 * dentro de um campo de texto.
 *
 * `showDeleted=true` é obrigatório no modo incremental: é assim que a
 * Google avisa que um evento foi apagado (`status: 'cancelled'`), e sem
 * isso o espelho guarda para sempre o que já não existe.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  options: {
    syncToken?: string | null;
    timeMin?: string;
    timeMax?: string;
    pageToken?: string;
  }
): Promise<EventsPage> {
  const params = new URLSearchParams({
    singleEvents: 'true',
    showDeleted: 'true',
    maxResults: '250',
  });

  if (options.syncToken) {
    params.set('syncToken', options.syncToken);
  } else {
    // `timeMin`/`timeMax` e `syncToken` são mutuamente exclusivos: mandar
    // os dois é 400. A janela só vale na importação completa.
    if (options.timeMin) params.set('timeMin', options.timeMin);
    if (options.timeMax) params.set('timeMax', options.timeMax);
    params.set('orderBy', 'startTime');
  }
  if (options.pageToken) params.set('pageToken', options.pageToken);

  const data = await call<{
    items?: GoogleEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
  }>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
  );

  return {
    items: data.items ?? [],
    nextPageToken: data.nextPageToken,
    nextSyncToken: data.nextSyncToken,
  };
}

/** Cria um evento com id fornecido — o determinístico do §D4. */
export async function insertEvent(
  accessToken: string,
  calendarId: string,
  body: Record<string, unknown>
): Promise<GoogleEvent> {
  return call<GoogleEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>
): Promise<GoogleEvent> {
  return call<GoogleEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  );
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  try {
    await call<void>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' }
    );
  } catch (error) {
    // Apagar o que já não existe é sucesso, não falha: o destino
    // pretendido foi alcançado por outra pessoa antes.
    if (error instanceof GoogleApiError && (error.isGone || error.status === 410)) {
      return;
    }
    throw error;
  }
}

/**
 * Cria, e se já existir, atualiza.
 *
 * O 409 do id determinístico não é erro — é a resposta certa a um envio
 * repetido, e a razão de o id ser determinístico. Tratá-lo como falha
 * deixaria toda tarefa reenviada em `error` para sempre.
 */
export async function upsertEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>
): Promise<GoogleEvent> {
  try {
    return await insertEvent(accessToken, calendarId, body);
  } catch (error) {
    if (error instanceof GoogleApiError && error.alreadyExists) {
      return patchEvent(accessToken, calendarId, eventId, body);
    }
    throw error;
  }
}
