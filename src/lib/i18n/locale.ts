/**
 * The one locale this instance speaks.
 *
 * Split out of `dates.ts` so a module that only needs the BCP-47 tag —
 * `formatCurrency`, a `toLocaleDateString`, a number in a table — can have it
 * without pulling `date-fns/locale` into its bundle. `dates.ts` re-exports it,
 * so nothing that already imported it from there has to change.
 *
 * Read at module scope: it is a build-time public env var, identical on server
 * and client, so there is nothing to re-evaluate per render and no hydration
 * mismatch to create.
 *
 * WHY A CONFIGURED LOCALE AND NOT THE VIEWER'S. `toLocaleDateString()` and
 * `Intl.NumberFormat(undefined, …)` follow the BROWSER's language — whatever
 * the person happened to install. On a self-hosted CRM that produced two
 * spellings of the same number on one screen: the deal card grouped
 * 143123421 as "143,123,421" for an operator with an en-US Chrome while the
 * field they typed it into grouped it "143.123.421" from the message
 * catalogue. The app's language is a property of the installation, not of the
 * machine looking at it.
 */
export const APP_LOCALE = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';
