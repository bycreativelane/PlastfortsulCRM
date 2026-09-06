import { addDays, fromISO, toISO } from '@/lib/calendar';
import { parseHHmm, safeTimeZone } from '@/lib/automations/local-time';

/**
 * O expediente, como aritmética.
 *
 * Irmão de `lib/calendar.ts`, e escrito com a mesma disciplina: tudo aqui
 * fala em chaves de dia `YYYY-MM-DD` e horas de parede `HH:MM`, nunca em
 * `Date` com fuso. A razão é a mesma que aquele arquivo explica no topo —
 * `new Date('2026-06-23')` é meia-noite UTC, que é o dia anterior a oeste de
 * Greenwich. Um módulo que responde "a empresa abre às 8" não tem por que
 * tocar em instante nenhum, e o que não toca não erra.
 *
 * A CONVERSÃO PARA INSTANTE MORA EM OUTRO LUGAR. Quando alguém precisar do
 * momento exato em que a segunda-feira abre — o motor calculando um
 * lembrete, por exemplo — `zonedTimeToUtc(dia, minutos, hours.timezone)` de
 * `lib/automations/local-time.ts` faz isso, com o cuidado de horário de
 * verão que já está escrito lá. Aqui só se decide QUE dia e QUE hora.
 *
 * `weekday` é 0 = domingo, como `Date.getDay()` e como a coluna da 066 — e
 * deliberadamente NÃO como o ISO-8601, que começa na segunda. Converter na
 * fronteira é exatamente onde nasce o erro de um dia.
 */

/** Um intervalo de expediente. `08:00`–`12:00`. */
export interface HourInterval {
  /** `HH:MM`, hora de parede. */
  opens: string;
  /** `HH:MM`, sempre maior que `opens` (a 066 garante por constraint). */
  closes: string;
}

/** Uma linha de `business_hours`. */
export interface WeeklyInterval extends HourInterval {
  /** 0 = domingo. */
  weekday: number;
}

/** Uma linha de `business_hours_exceptions`. */
export interface HoursException {
  /** `YYYY-MM-DD`. */
  date: string;
  closed: boolean;
  opens: string | null;
  closes: string | null;
  label: string | null;
}

/** Tudo o que se precisa saber sobre o relógio de uma conta. */
export interface BusinessHours {
  /** Fuso IANA de `accounts.timezone`. */
  timezone: string;
  /** 0 = domingo. */
  weekStartsOn: number;
  /** 15, 30 ou 60 — a altura de uma linha na grade de dia. */
  slotMinutes: number;
  weekly: WeeklyInterval[];
  exceptions: HoursException[];
}

/**
 * O expediente que a 066 semeia, e o que se desenha enquanto o de verdade
 * não chegou do banco.
 *
 * Um padrão em vez de "vazio" porque vazio, aqui, é indistinguível de
 * "fechado o tempo todo": a grade de dia não teria linha nenhuma e o
 * atalho "amanhã" não teria hora. Enquanto carrega, o produto mostra a
 * semana comercial brasileira, que é o que ele mostraria de qualquer forma
 * em 99% das contas.
 */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  timezone: 'America/Sao_Paulo',
  weekStartsOn: 0,
  slotMinutes: 30,
  weekly: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, opens: '08:00', closes: '12:00' },
    { weekday, opens: '13:30', closes: '18:00' },
  ]),
  exceptions: [],
};

// ------------------------------------------------------------
// Horas de parede
// ------------------------------------------------------------

/**
 * `HH:MM` a partir do que quer que o Postgres tenha devolvido.
 *
 * Uma coluna TIME volta como `'08:00:00'`, e comparar `'08:00:00'` com
 * `'08:00'` por string dá desigual. Normalizar na fronteira do banco é
 * mais barato que lembrar disso em cada comparação.
 */
export function toHHMM(value: string | null | undefined): string | null {
  if (!value) return null;
  const minutes = parseHHmm(value.slice(0, 5));
  return minutes === null ? null : fromMinutes(minutes);
}

/** `HH:MM` → minutos depois da meia-noite. `-1` quando não é hora. */
export function minutesOf(hhmm: string): number {
  const minutes = parseHHmm(hhmm);
  return minutes === null ? -1 : minutes;
}

/** Minutos depois da meia-noite → `HH:MM`. */
export function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// ------------------------------------------------------------
// O expediente de um dia
// ------------------------------------------------------------

/**
 * Os intervalos de um dia, já com a exceção aplicada e em ordem.
 *
 * Uma exceção SUBSTITUI a semana daquele dia em vez de se somar a ela: é o
 * que "fechado no feriado" e "no dia 24 fechamos ao meio-dia" querem dizer,
 * e a alternativa (somar) não conseguiria expressar nem uma nem outra.
 */
export function intervalsFor(
  hours: BusinessHours,
  iso: string
): HourInterval[] {
  const exception = hours.exceptions.find((e) => e.date === iso);
  if (exception) {
    if (exception.closed || !exception.opens || !exception.closes) return [];
    return [{ opens: exception.opens, closes: exception.closes }];
  }

  const date = fromISO(iso);
  if (!date) return [];
  const weekday = date.getDay();

  return hours.weekly
    .filter((row) => row.weekday === weekday)
    .map(({ opens, closes }) => ({ opens, closes }))
    .sort((a, b) => minutesOf(a.opens) - minutesOf(b.opens));
}

/** O dia tem algum expediente. Feriado e domingo respondem `false`. */
export function isBusinessDay(hours: BusinessHours, iso: string): boolean {
  return intervalsFor(hours, iso).length > 0;
}

/** A empresa está aberta neste dia, nesta hora de parede. */
export function isOpenAt(
  hours: BusinessHours,
  iso: string,
  hhmm: string
): boolean {
  const at = minutesOf(hhmm);
  if (at < 0) return false;
  return intervalsFor(hours, iso).some(
    // Aberto no minuto em que abre, fechado no minuto em que fecha: às
    // 18:00 de um expediente que vai até as 18:00 já não se atende.
    (i) => at >= minutesOf(i.opens) && at < minutesOf(i.closes)
  );
}

/** A primeira hora de um dia, ou `null` se ele for fechado. */
export function firstOpenTime(
  hours: BusinessHours,
  iso: string
): string | null {
  return intervalsFor(hours, iso)[0]?.opens ?? null;
}

/**
 * Quantos dias adiante vale a pena procurar por expediente.
 *
 * Uma conta pode, legitimamente, ter apagado a semana inteira. Sem um teto
 * a busca andaria para sempre; com este, ela desiste depois de dois meses e
 * devolve `null`, que quem chama trata como "sem sugestão de horário".
 */
const SEARCH_LIMIT_DAYS = 60;

/**
 * O próximo momento em que a empresa está aberta, a partir de um ponto.
 *
 * É o que responde "amanhã" no seletor de prazo de uma tarefa: sexta às 19h
 * mais um dia é sábado às 00:00, que é uma resposta que ninguém quis. A
 * daqui é segunda às 08:00.
 *
 * Se o ponto de partida já estiver dentro do expediente, ele mesmo é a
 * resposta — a função não empurra para o próximo intervalo quem já está
 * dentro de um.
 */
export function nextOpenSlot(
  hours: BusinessHours,
  iso: string,
  hhmm: string | null = null
): { day: string; time: string } | null {
  const from = fromISO(iso);
  if (!from) return null;

  const at = hhmm === null ? -1 : minutesOf(hhmm);

  for (let offset = 0; offset <= SEARCH_LIMIT_DAYS; offset++) {
    const day = offset === 0 ? iso : toISO(addDays(from, offset));
    for (const interval of intervalsFor(hours, day)) {
      const opens = minutesOf(interval.opens);
      const closes = minutesOf(interval.closes);
      // Só o primeiro dia carrega a hora de partida; nos seguintes a
      // pergunta é sempre "quando abre".
      const floor = offset === 0 ? at : -1;
      if (floor < opens) return { day, time: interval.opens };
      if (floor < closes) return { day, time: fromMinutes(floor) };
    }
  }

  return null;
}

/**
 * `n` dias ÚTEIS adiante — o que "+3 dias" quer dizer num CRM.
 *
 * O dia de partida não conta, aberto ou não: "daqui a um dia útil", numa
 * sexta, é a segunda; num sábado, também. `n = 0` devolve o próprio dia,
 * sem procurar nada.
 */
export function addBusinessDays(
  hours: BusinessHours,
  iso: string,
  n: number
): string {
  const start = fromISO(iso);
  if (!start || n === 0) return iso;

  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cursor = start;

  for (let guard = 0; guard < SEARCH_LIMIT_DAYS * 2 && remaining > 0; guard++) {
    cursor = addDays(cursor, step);
    if (isBusinessDay(hours, toISO(cursor))) remaining--;
  }

  // Semana inteira fechada: devolve o deslocamento em dias corridos, que é
  // impreciso e visível, em vez de `iso`, que seria a função fingindo não
  // ter sido chamada.
  if (remaining > 0) return toISO(addDays(start, n));
  return toISO(cursor);
}

/**
 * Entre que horas desenhar uma grade de dia ou semana.
 *
 * Arredondado para a hora cheia para fora, porque uma grade que começa às
 * 08:00 e mostra um compromisso das 07:45 recorta o compromisso. Meia hora
 * de folga de cada lado é o que separa "a régua da empresa" de "a régua que
 * esconde coisa".
 *
 * `days` restringe a leitura aos dias em tela — assim uma exceção de sábado
 * não estica a grade de uma semana que não tem sábado. Sem ele, a semana
 * inteira e todas as exceções entram na conta.
 */
export function dayBounds(
  hours: BusinessHours,
  days?: string[]
): { startHour: number; endHour: number } {
  const intervals = days
    ? days.flatMap((iso) => intervalsFor(hours, iso))
    : [
        ...hours.weekly,
        ...hours.exceptions
          .filter((e) => !e.closed && e.opens && e.closes)
          .map((e) => ({
            opens: e.opens as string,
            closes: e.closes as string,
          })),
      ];

  if (intervals.length === 0) return { startHour: 8, endHour: 18 };

  let first = 24 * 60;
  let last = 0;
  for (const interval of intervals) {
    first = Math.min(first, minutesOf(interval.opens));
    last = Math.max(last, minutesOf(interval.closes));
  }

  const startHour = Math.max(0, Math.floor(first / 60) - 1);
  const endHour = Math.min(24, Math.ceil(last / 60) + 1);
  return { startHour, endHour };
}

// ------------------------------------------------------------
// Do banco para cá
// ------------------------------------------------------------

export interface AccountClockRow {
  timezone?: string | null;
  week_starts_on?: number | null;
  slot_minutes?: number | null;
}

export interface BusinessHourRow {
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export interface HoursExceptionRow {
  on_date: string;
  closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
  label: string | null;
}

/**
 * As três consultas viram um `BusinessHours`.
 *
 * Um só lugar faz a conversão — normalizar `08:00:00` para `08:00`, cair
 * no padrão quando a 066 ainda não rodou, recusar um fuso que o runtime não
 * conhece — para que o gancho do navegador e qualquer rota do servidor
 * respondam a mesma coisa sobre a mesma conta.
 */
export function toBusinessHours(
  account: AccountClockRow | null | undefined,
  weekly: BusinessHourRow[] | null | undefined,
  exceptions: HoursExceptionRow[] | null | undefined
): BusinessHours {
  const rows = (weekly ?? []).flatMap<WeeklyInterval>((row) => {
    const opens = toHHMM(row.opens_at);
    const closes = toHHMM(row.closes_at);
    if (!opens || !closes) return [];
    return [{ weekday: row.weekday, opens, closes }];
  });

  return {
    timezone: safeTimeZone(account?.timezone),
    weekStartsOn:
      account?.week_starts_on ?? DEFAULT_BUSINESS_HOURS.weekStartsOn,
    slotMinutes: account?.slot_minutes ?? DEFAULT_BUSINESS_HOURS.slotMinutes,
    // Conta sem nenhuma linha é conta cuja migração ainda não rodou — não é
    // uma empresa que fecha sete dias por semana. Ver a nota do padrão.
    weekly: rows.length > 0 ? rows : DEFAULT_BUSINESS_HOURS.weekly,
    exceptions: (exceptions ?? []).flatMap<HoursException>((row) => {
      const date = row.on_date?.slice(0, 10);
      if (!date) return [];
      return [
        {
          date,
          closed: row.closed,
          opens: toHHMM(row.opens_at),
          closes: toHHMM(row.closes_at),
          label: row.label ?? null,
        },
      ];
    }),
  };
}
