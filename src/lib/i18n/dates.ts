import { enUS, ko, ptBR, type Locale } from 'date-fns/locale';

import { APP_LOCALE } from './locale';

/**
 * Where the app's language reaches dates.
 *
 * next-intl translates strings. It does not translate the two things
 * that produce dates here — `date-fns` and `Intl` — and neither of them
 * guesses: `formatDistanceToNow(d)` with no options is English, always,
 * and `toLocaleDateString()` with no argument follows the BROWSER's
 * language, which is whatever the person happened to install and has
 * nothing to do with what this instance is configured to speak.
 *
 * So a Portuguese CRM showed "about 2 hours ago" under every
 * notification, "3 days ago" on every deal card, and — in one place
 * that passed `'en-US'` outright — "Aug 22, 2026" in a table of
 * Brazilian customers. Three different answers on one screen.
 *
 * One answer instead, from the same `NEXT_PUBLIC_APP_LOCALE` that picks
 * the message catalogue. Read at module scope: it is a build-time
 * public env var, identical on server and client, so there is nothing
 * to re-evaluate per render and no hydration mismatch to create.
 */
const LOCALES: Record<string, Locale> = {
  'pt-BR': ptBR,
  en: enUS,
  'en-US': enUS,
  ko,
};

/**
 * BCP-47 tag for `Intl` / `toLocaleDateString` / `Intl.NumberFormat`.
 * Defined in `./locale` and re-exported here so callers that only need the
 * tag can import it without dragging `date-fns/locale` into their bundle.
 */
export { APP_LOCALE } from './locale';

/**
 * The `date-fns` locale object, for the `{ locale }` option every
 * `format` / `formatDistanceToNow` call needs. Falls back to English
 * rather than throwing: an instance configured for a language we have
 * no date-fns bundle for should show English dates, not a blank page.
 */
export const dateLocale: Locale = LOCALES[APP_LOCALE] ?? enUS;

/** `{ locale: … }`, ready to spread into a date-fns call. */
export const dateFnsOptions = { locale: dateLocale } as const;

/**
 * "22 de ago." / "Aug 22" — a chart axis label, in the order the
 * language actually writes it.
 *
 * date-fns has localized tokens for whole dates (`P`, `PP`, `PPP`) but
 * none for a bare month-and-day, so a pattern like `'MMM d'` hard-codes
 * American order and renders "ago. 22" in Portuguese. `Intl` knows the
 * order for every locale; this is the one case worth reaching for it.
 */
export function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
  }).format(date);
}
