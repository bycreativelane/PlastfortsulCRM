/**
 * Telling a missing migration apart from a broken request.
 *
 * Migrations are applied by hand, so between "the code shipped" and "044 ran"
 * there is a window where the interface offers a shortcut field the table has
 * no column for. PostgREST answers that with `PGRST204` and a message naming
 * the column, which reaches the operator as a toast reading "Could not find
 * the 'shortcut' column of 'quick_replies' in the schema cache" — a sentence
 * that sounds like the feature is broken rather than pending.
 *
 * The same shape as `isMissingTableError` in src/lib/occurrences/kinds.ts,
 * for the same reason.
 */

const COLUMNS_044 = /'?(shortcut|media_url|media_type)'?/i;

export function isMissingQuickReplyColumn(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const message = error.message ?? '';
  if (error.code === 'PGRST204') return COLUMNS_044.test(message);
  // 42703 = undefined_column, if the request ever reaches Postgres directly.
  if (error.code === '42703') return COLUMNS_044.test(message);
  return (
    COLUMNS_044.test(message) &&
    /(does not exist|could not find)/i.test(message)
  );
}

export const MISSING_MIGRATION_MESSAGE =
  'Shortcuts and file snippets need migration 044 ' +
  '(044_quick_reply_shortcut_media.sql), which has not been applied yet. ' +
  'Text and interactive quick replies still work.';
