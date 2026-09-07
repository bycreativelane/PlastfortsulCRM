/**
 * Da Google para cá, e daqui para a Google.
 *
 * Este arquivo é pequeno e é onde os erros desta integração moram. O §D3 do
 * plano avisa: "dia inteiro ↔ `start.date` é onde os erros moram", e a razão
 * é que a Google tem DOIS modelos de tempo no mesmo campo e eles não se
 * convertem um no outro sem perder informação.
 *
 * ------------------------------------------------------------------
 * O FIM EXCLUSIVO — o bug clássico
 * ------------------------------------------------------------------
 *
 * Num evento de dia inteiro, `end.date` da Google é EXCLUSIVO: um
 * compromisso que dura só o dia 7 chega como
 * `start.date = 2026-09-07`, `end.date = 2026-09-08`.
 *
 * Guardar os dois como vieram faz todo evento de um dia parecer de dois, e
 * o sintoma aparece longe daqui — numa faixa de "dia todo" que atravessa
 * duas colunas da semana. Guardamos o fim INCLUSIVO (o último dia em que o
 * evento acontece) e devolvemos o exclusivo na hora de escrever. A
 * conversão fica nas duas funções abaixo e em lugar nenhum mais.
 *
 * ------------------------------------------------------------------
 * E O DIA INTEIRO NUNCA VIRA TIMESTAMP
 * ------------------------------------------------------------------
 *
 * `lib/calendar.ts` explica no topo por que este produto não passa uma
 * data por `new Date()`: meia-noite UTC é o dia anterior a oeste de
 * Greenwich. Um aniversário importado que aparece no dia 6 porque veio
 * como `2026-09-07T00:00:00Z` é exatamente esse erro, e a migração 069
 * guarda os dois modelos lado a lado justamente para nunca ter que
 * escolher.
 */

/** O que a Calendar API devolve num item de `events.list`. */
export interface GoogleEvent {
  id?: string;
  etag?: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  organizer?: { email?: string };
  attendees?: Array<{ email?: string }>;
}

export interface GoogleEventTime {
  /** Presente só no dia inteiro, `YYYY-MM-DD`. */
  date?: string;
  /** Presente só no marcado, RFC3339. */
  dateTime?: string;
  timeZone?: string;
}

/** A forma que a 069 guarda. */
export interface MirrorEvent {
  external_id: string;
  ical_uid: string | null;
  etag: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  html_link: string | null;
  all_day: boolean;
  /** `YYYY-MM-DD`. Só no dia inteiro. */
  start_date: string | null;
  /** `YYYY-MM-DD` INCLUSIVO — o último dia do evento. Ver o cabeçalho. */
  end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string | null;
  organizer_email: string | null;
  attendee_emails: string[];
}

/**
 * `2026-09-08` → `2026-09-07`. O fim exclusivo da Google vira o inclusivo
 * daqui.
 *
 * Aritmética de string via `Date.UTC`, e não `new Date(iso)`: aqui o UTC é
 * seguro porque entra e sai uma data pura, sem fuso envolvido em momento
 * algum — é a única situação em que passar uma data por `Date` não mente.
 */
export function exclusiveToInclusive(endDate: string): string | null {
  const parsed = parseDateOnly(endDate);
  if (!parsed) return null;
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return toDateOnly(parsed);
}

/** O caminho de volta: o último dia daqui vira o fim exclusivo da Google. */
export function inclusiveToExclusive(endDate: string): string | null {
  const parsed = parseDateOnly(endDate);
  if (!parsed) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return toDateOnly(parsed);
}

function parseDateOnly(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Um evento da Google vira uma linha do espelho.
 *
 * Devolve `null` para o que não dá para guardar — sem `id` não há chave, e
 * sem começo não há onde desenhar. Um evento assim é descartado com um
 * contador em vez de derrubar a importação inteira: a lista tem centenas de
 * itens e um deles malformado não pode custar os outros.
 */
export function toMirrorEvent(event: GoogleEvent): MirrorEvent | null {
  if (!event.id) return null;

  const allDay = Boolean(event.start?.date);
  const startDate = event.start?.date ?? null;
  const startsAt = event.start?.dateTime ?? null;

  if (!startDate && !startsAt) return null;

  // O fim é opcional na prática — a Google quase sempre manda, mas um
  // evento sem fim é um evento de um dia (ou de um instante), não um erro.
  const endDate = event.end?.date
    ? exclusiveToInclusive(event.end.date)
    : startDate;

  return {
    external_id: event.id,
    ical_uid: event.iCalUID ?? null,
    etag: event.etag ?? null,
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    html_link: event.htmlLink ?? null,
    all_day: allDay,
    start_date: startDate,
    end_date: allDay ? endDate : null,
    starts_at: startsAt,
    ends_at: event.end?.dateTime ?? null,
    status: event.status ?? null,
    organizer_email: normalizeEmail(event.organizer?.email),
    attendee_emails: (event.attendees ?? [])
      .map((a) => normalizeEmail(a.email))
      .filter((email): email is string => email !== null),
  };
}

/**
 * Minúsculas e sem espaço em volta.
 *
 * O casamento com `contacts.email` é por igualdade, e a Google devolve o
 * e-mail como a pessoa o digitou no convite. "Maria@Empresa.com" e
 * "maria@empresa.com" são a mesma caixa e precisam casar com o mesmo
 * contato.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * O id determinístico do §D4: uma tarefa sempre gera o MESMO id de evento.
 *
 * A Google aceita id fornecido pelo cliente em base32hex — dígitos `0-9` e
 * letras `a-v`, de 5 a 1024 caracteres. Um UUID sem hífens é hexadecimal,
 * que é subconjunto de base32hex, então cabe sem tradução.
 *
 * O prefixo é `crm` e não `wacrm`: **`w` não existe em base32hex**, e o
 * alfabeto para em `v`. Um id com `w` é recusado pela API — e recusado no
 * envio, não na compilação, então o teste que fixa o alfabeto é a única
 * coisa entre isto e uma integração que falha inteira contra a Google real.
 *
 * Isso torna o envio idempotente de graça: uma repetição por timeout
 * devolve 409 em vez de criar um evento gêmeo, e o 409 é tratado como
 * "já existe, então PATCH". A linha de vínculo continua sendo a verdade —
 * o id determinístico é o cinto, ela é o suspensório.
 */
export function eventIdForTask(taskId: string): string {
  return `crm${taskId.replace(/-/g, '').toLowerCase()}`;
}

/**
 * Uma tarefa vira o corpo de um evento da Google.
 *
 * `dueTime` ausente produz um evento de DIA INTEIRO, e não um às 00:00 —
 * é a razão de a 068 guardar dia e hora em colunas separadas. "Ligar hoje"
 * publicado como "00:00–00:30" seria uma reunião de madrugada na agenda de
 * alguém.
 */
export function taskToEvent(task: {
  id: string;
  title: string;
  description?: string | null;
  due_on?: string | null;
  due_time?: string | null;
  duration_minutes?: number | null;
  status?: string;
}): Record<string, unknown> | null {
  if (!task.due_on) return null;

  const body: Record<string, unknown> = {
    id: eventIdForTask(task.id),
    // A regra 4 do §D5: concluída não some da agenda, ganha um ✓. Quem
    // olha a semana passada quer ver que aquilo aconteceu.
    summary: task.status === 'done' ? `✓ ${task.title}` : task.title,
    description: task.description ?? undefined,
  };

  if (!task.due_time) {
    const end = inclusiveToExclusive(task.due_on);
    body.start = { date: task.due_on };
    body.end = { date: end ?? task.due_on };
    return body;
  }

  const minutes = task.duration_minutes ?? 30;
  body.start = { dateTime: `${task.due_on}T${padTime(task.due_time)}` };
  body.end = {
    dateTime: `${task.due_on}T${padTime(addMinutes(task.due_time, minutes))}`,
  };
  return body;
}

/**
 * `14:30` → `14:30:00`, e o fuso fica de fora de propósito.
 *
 * A Google resolve um `dateTime` sem deslocamento no fuso da AGENDA de
 * destino, que é o da empresa — exatamente o fuso em que `due_time` foi
 * escrito (066). Carimbar um deslocamento aqui obrigaria a calcular o
 * horário de verão do dia certo, que é trabalho para errar de graça.
 */
function padTime(hhmm: string): string {
  const [h = '00', m = '00'] = hhmm.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h = '0', m = '0'] = hhmm.split(':');
  const total = Number(h) * 60 + Number(m) + minutes;
  // Um compromisso que passa da meia-noite é preso às 23:59 do mesmo dia.
  // O §C1 da 068 guarda dia e hora separados justamente para não precisar
  // representar "atravessa o dia", e inventar isso aqui criaria um evento
  // que a tarefa não sabe descrever de volta.
  const clamped = Math.min(total, 23 * 60 + 59);
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
