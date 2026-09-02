/**
 * Wall-clock time in a named zone, for the parts of the engine that speak
 * in dates rather than durations: the birthday sweep and the "wait until
 * the date in this field" step.
 *
 * The cron runs in whatever zone the host is in — usually UTC — and "today"
 * in UTC is already "tomorrow" at 21:00 in Brasília. Nothing here reads the
 * process zone; every answer is computed for the zone it was asked in.
 */

/** The installation's zone. There is no per-account zone in the schema. */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** `YYYY-MM-DD` — what a DATE column compares equal to. */
  dateKey: string;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** A zone the runtime knows, or the default when it does not. */
export function safeTimeZone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    formatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The wall-clock parts of `date` as seen in `timeZone`. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = formatter(safeTimeZone(timeZone)).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // `hourCycle: 'h23'` is honoured by every current runtime, but "24" has
  // been seen from older ICU builds at midnight; fold it.
  const hour = get('hour') % 24;
  const minute = get('minute');
  return {
    year,
    month,
    day,
    hour,
    minute,
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
  };
}

/** `HH:mm` → minutes after midnight, or null when it is not a time. */
export function parseHHmm(value?: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** `YYYY-MM-DD` → its parts, or null when it is not a date. */
export function parseDateKey(
  value?: string | null
): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * The instant at which `dateKey` reaches `minutesAfterMidnight` on the
 * wall clock of `timeZone`.
 *
 * Two passes rather than one: the zone's offset at the guessed instant is
 * what the correction needs, and across a DST edge the offset at the guess
 * and the offset at the answer differ. The second pass settles it; a wall
 * time that does not exist on a spring-forward day lands on the instant
 * after the gap, which is the useful answer for "send at 09:00".
 */
export function zonedTimeToUtc(
  dateKey: string,
  minutesAfterMidnight: number,
  timeZone: string
): Date | null {
  const parts = parseDateKey(dateKey);
  if (!parts) return null;
  const zone = safeTimeZone(timeZone);
  const wallMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(minutesAfterMidnight / 60),
    minutesAfterMidnight % 60,
    0,
    0
  );
  let guess = wallMs;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(new Date(guess), zone);
    const seenMs = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      0,
      0
    );
    guess += wallMs - seenMs;
  }
  return new Date(guess);
}
