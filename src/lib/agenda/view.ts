import { addDays, monthMatrix, toISO } from '@/lib/calendar';
import type { AgendaItem, AgendaKind } from '@/lib/dashboard/agenda';
import { minutesOf } from '@/lib/hours';

/**
 * As contas puras da página `/agenda`.
 *
 * Estão aqui e não dentro dos componentes porque são as únicas partes da
 * tela em que dá para estar ERRADO de um jeito silencioso: uma semana que
 * começa no dia errado desenha sete dias plausíveis e nenhum deles é a
 * semana certa, e um item posicionado fora do eixo simplesmente não aparece.
 * Nada disso quebra o build nem levanta exceção — só mente.
 */

export type AgendaView = 'month' | 'week' | 'day';

export const AGENDA_VIEWS: readonly AgendaView[] = [
  'month',
  'week',
  'day',
] as const;

export function isAgendaView(value: string | null): value is AgendaView {
  return value !== null && (AGENDA_VIEWS as readonly string[]).includes(value);
}

/**
 * O domingo (ou segunda, ou o que a conta disser) da semana de `date`.
 *
 * `weekStart` vem de `accounts.week_starts_on` e não do locale. Os dois
 * discordam de propósito: o locale diz como o PAÍS conta a semana, a conta
 * diz como a EMPRESA conta — e uma empresa que abre no sábado e fecha na
 * quarta não fica melhor servida pelo calendário do Brasil.
 */
export function startOfWeek(date: Date, weekStart: number): Date {
  const shift = (date.getDay() - weekStart + 7) % 7;
  return addDays(date, -shift);
}

export interface AgendaRange {
  from: Date;
  to: Date;
  /** Os dias em tela, `YYYY-MM-DD`, na ordem em que são desenhados. */
  days: string[];
}

/**
 * A janela que cada modo carrega.
 *
 * O mês carrega as seis semanas da grade inteira, e não os dias do mês:
 * a `MonthGrid` desenha os dias vizinhos, e um item que cai num deles tem
 * que aparecer. Carregar só o mês deixaria as pontas da grade vazias de um
 * jeito que parece "não tem nada" em vez de "não carreguei".
 */
export function rangeFor(
  view: AgendaView,
  cursor: Date,
  weekStart: number
): AgendaRange {
  if (view === 'day') {
    return { from: cursor, to: cursor, days: [toISO(cursor)] };
  }

  if (view === 'week') {
    const first = startOfWeek(cursor, weekStart);
    const days = Array.from({ length: 7 }, (_, i) => toISO(addDays(first, i)));
    return { from: first, to: addDays(first, 6), days };
  }

  const matrix = monthMatrix(cursor, weekStart);
  return {
    from: matrix[0],
    to: matrix[matrix.length - 1],
    days: matrix.map(toISO),
  };
}

export interface AgendaFilter {
  /** Tipos DESMARCADOS. Vazio = mostra tudo, que é o estado inicial. */
  hidden: ReadonlySet<AgendaKind>;
  /**
   * `'all'`, `'mine'`, ou um id de usuário do auth.
   *
   * Um item sem dono (`owner === null`) NUNCA é escondido por este filtro.
   * Ver a nota em `AgendaItem.owner`: aniversário e campanha não são de
   * ninguém, e "Minhas" perguntando "de quem é isto" não deveria apagar as
   * respostas que legitimamente são "de ninguém".
   */
  owner: 'all' | 'mine' | string;
  /** O id de auth de quem está olhando. Null enquanto o perfil carrega. */
  me: string | null;
}

export function filterAgenda(
  items: AgendaItem[],
  { hidden, owner, me }: AgendaFilter
): AgendaItem[] {
  return items.filter((item) => {
    if (hidden.has(item.kind)) return false;
    if (owner === 'all' || item.owner === null) return true;
    const wanted = owner === 'mine' ? me : owner;
    // Sem saber quem eu sou, "Minhas" não tem resposta. Mostrar tudo é o
    // lado certo de errar: esconder o trabalho de alguém porque o perfil
    // ainda não voltou é uma tela vazia que parece um dia livre.
    if (!wanted) return true;
    return item.owner === wanted;
  });
}

/**
 * As linhas do eixo de horas, de `startHour` a `endHour`.
 *
 * `slotMinutes` (15, 30 ou 60) vem da conta e decide a altura de uma linha.
 */
export function hourSlots(
  startHour: number,
  endHour: number,
  slotMinutes: number
): string[] {
  const slots: string[] = [];
  const step = slotMinutes > 0 ? slotMinutes : 60;
  for (let m = startHour * 60; m < endHour * 60; m += step) {
    const h = Math.floor(m / 60);
    slots.push(`${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return slots;
}

/**
 * Onde um item com hora fica no eixo, em porcentagem do alto.
 *
 * Devolve `null` para o que não tem hora — e isso é metade da agenda. Um
 * aniversário não acontece às 14h; forçá-lo para o topo do eixo inventaria
 * uma precisão que o dado não tem. Esses vão para a faixa de "o dia todo",
 * acima do eixo, que é onde eles são verdadeiros.
 *
 * O que tem hora mas cai FORA do expediente é preso na borda em vez de
 * sumir: uma tarefa marcada para as 22h numa empresa que fecha às 18h é
 * exatamente o tipo de coisa que alguém precisa ver.
 */
export function positionOf(
  item: Pick<AgendaItem, 'time'>,
  startHour: number,
  endHour: number,
  durationMinutes = 30
): { top: number; height: number } | null {
  if (!item.time) return null;

  const span = (endHour - startHour) * 60;
  if (span <= 0) return null;

  const start = minutesOf(item.time) - startHour * 60;
  const clamped = Math.max(0, Math.min(start, span));
  const height = Math.min(durationMinutes, span - clamped);

  return {
    top: (clamped / span) * 100,
    height: (Math.max(height, 15) / span) * 100,
  };
}

/** Os itens de um dia que não têm hora — a faixa acima do eixo. */
export function allDayItems(items: AgendaItem[]): AgendaItem[] {
  return items.filter((item) => !item.time);
}

/** Os itens de um dia que têm hora — os que o eixo posiciona. */
export function timedItems(items: AgendaItem[]): AgendaItem[] {
  return items.filter((item) => item.time);
}
