/**
 * Telling "the schema has not caught up yet" apart from "this broke".
 *
 * Migrations in this project are applied by hand, deliberately — an agent
 * writes the file, Gabriel runs it. That leaves a real window in which the
 * code knows about a column the database does not, and during that window
 * the honest thing for a write to do is fall back to what it did before,
 * not fail.
 *
 * The sibling of `isMissingTableError` in `@/lib/occurrences/kinds`, which
 * answers the same question one level up (the whole relation is missing) for
 * a feature that can reasonably refuse to work until then. A column is
 * different: the surrounding write usually still has a job to do without it.
 */

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

/**
 * True when the failure is "that column is not there".
 *
 * Postgres answers `42703` (undefined_column). PostgREST answers `PGRST204`
 * when the column is missing from its schema cache, which is what a client
 * actually sees for a few seconds after a migration too.
 */
export function isUnknownColumn(error: PostgrestLikeError): boolean {
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .* does not exist|could not find the .* column/i.test(
    error.message ?? ''
  );
}
