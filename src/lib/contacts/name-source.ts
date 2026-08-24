import { isUnknownColumn } from '@/lib/supabase/pg-errors';

/**
 * "A person typed this name, leave it alone."
 *
 * Every inbound WhatsApp message compares the sender's profile name against
 * the stored one and refreshes it if they differ. That is right for a
 * contact nobody has touched — it is what turns `+55 54 9…` into a name —
 * and it was catastrophic for one somebody had renamed: the edit stuck until
 * the customer's next message, then silently reverted. Reported as "depois
 * de alguns minutos volta o nome que estava antes", and the minutes were
 * however long the customer took to write back.
 *
 * `contacts.name_source` (migration 045) records which of the two wrote the
 * name, and the webhook only overwrites its own work. This wrapper is how
 * every human-facing write claims authorship — the contact form, the inline
 * rename on the contact page, the CSV import.
 *
 * WHY A WRAPPER AND NOT JUST A FIELD. Migrations here are applied by hand,
 * so between shipping this and running 045 the column does not exist, and a
 * plain `name_source: 'manual'` in the payload would fail the whole write —
 * turning a silent revert into an outright "cannot save a contact". One
 * retry without the field degrades that to the old behaviour instead.
 */
export async function withManualName<R extends { error: unknown }>(
  attempt: (nameSource: Record<string, string>) => PromiseLike<R>
): Promise<R> {
  const claimed = await attempt({ name_source: 'manual' });

  const error = claimed.error as
    { code?: string | null; message?: string | null } | null | undefined;
  if (error && isUnknownColumn(error)) return attempt({});

  return claimed;
}
