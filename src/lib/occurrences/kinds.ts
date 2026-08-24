/**
 * The kinds of thing that go wrong, as the client wrote them.
 *
 * Fourteen, verbatim from spec section 13 and byte-identical to
 * `DATA.tiposOcorrencia` in the design prototype. Not translated and not
 * an enum in the database: this is the vocabulary of one packaging company's
 * quality problems, it will grow, and adding "Rotulagem" should be a decision
 * rather than a migration. `contact_occurrences.kind` is TEXT for that reason.
 *
 * Kept as a constant rather than a table for the same reason the contact-type
 * vocabulary is: it is a controlled list the interface offers, not data the
 * account maintains. If it ever becomes the latter, the column already
 * accepts anything.
 */
export const OCCURRENCE_KINDS = [
  'Problema com saco/produto',
  'Solda',
  'Resistência',
  'Medida',
  'Espessura',
  'Quantidade',
  'Qualidade',
  'Entrega',
  'Atraso',
  'Transportadora',
  'Produto errado',
  'Produto faltando',
  'Reclamação',
  'Outro',
] as const;

export type OccurrenceKind = (typeof OCCURRENCE_KINDS)[number];

/** The two states section 14 gives an occurrence. */
export type OccurrenceStatus = 'open' | 'resolved';

export interface ContactOccurrence {
  id: string;
  account_id: string;
  contact_id: string;
  deal_id?: string | null;
  kind: string;
  /** `YYYY-MM-DD`. */
  occurred_on: string;
  description: string;
  status: OccurrenceStatus;
  resolution?: string | null;
  final_note?: string | null;
  resolved_at?: string | null;
  handled_by?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * True when the failure is "the table does not exist yet".
 *
 * `042_contact_occurrences.sql` HAS been applied since this was written —
 * measured against the project in `.env.local`, where the table and
 * `contacts.occurrence_count` both answer. The guard stays anyway, and not
 * out of caution: migrations are applied by hand, one database at a time, so
 * "applied here" says nothing about the next account to run this build.
 *
 * PostgREST answers a missing relation with `PGRST205` (schema cache) or
 * Postgres `42P01`, and an operator whose database is a migration behind
 * deserves "this feature is waiting on a migration" rather than a raw
 * database string.
 */
export function isMissingTableError(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return (
    /contact_occurrences/i.test(error.message ?? '') &&
    /(does not exist|could not find)/i.test(error.message ?? '')
  );
}
