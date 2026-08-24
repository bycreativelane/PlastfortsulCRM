/**
 * Closing a deal, and the two things the CRM refuses to let you skip.
 *
 * A deal reaching "Atendido" with `value: 0` is a sale nobody can report on:
 * the column total lies, the average ticket lies, and the number is gone —
 * whoever knew it was the person clicking, at the moment they clicked. Same
 * for a loss with no reason. The prototype states it in the field hint:
 * "Obrigatório — alimenta o relatório de perdas."
 *
 * So both are GATES, not fields: the move does not happen until the answer
 * does. That is the whole design, and it is why this lives next to the write
 * rather than in a form somebody may or may not fill in later.
 */

/**
 * Stage names that mean the sale happened.
 *
 * Matched by name because stages are the account's data — the same reason the
 * contact-type vocabulary is a constant. `Atendido` is PlastfortSul's, `Ganho`
 * and `Won` are what a default pipeline calls it.
 */
const WON_STAGE_NAMES = ['atendido', 'ganho', 'won', 'fechado'];

/** Stage names that mean it is over and there was no sale. */
const LOST_STAGE_NAMES = ['perdido', 'perdida', 'lost'];

const norm = (v: string) => v.trim().toLowerCase();

export function isWonStage(stageName: string): boolean {
  return WON_STAGE_NAMES.includes(norm(stageName));
}

export function isLostStage(stageName: string): boolean {
  return LOST_STAGE_NAMES.includes(norm(stageName));
}

/**
 * The seven reasons, in the prototype's order.
 *
 * A fixed list and not free text, because the point of asking is the report:
 * twelve spellings of "preço" group into nothing. `other` carries the note
 * for everything the list does not cover, which is what keeps the list short.
 *
 * Stored as these keys, not as the label — the label is translated and the
 * report has to survive somebody switching the interface language.
 */
export const LOSS_REASONS = [
  'price',
  'freight',
  'leadTime',
  'competitor',
  'noReply',
  'productMismatch',
  'other',
] as const;

export type LossReason = (typeof LOSS_REASONS)[number];

/**
 * "Vai comprar depois" is deliberately NOT on this list.
 *
 * The prototype offered it with a note saying it is not a loss, and the note
 * was right — which makes the option wrong. A customer who said
 * yes-but-not-yet is alive, and the CRM already has the place for them:
 * Compra futura on the contact record, which sets the date the repurchase
 * automation reads. Every reason here is a reason the deal is OVER.
 */

/**
 * Postgres 42703: the column is not there.
 *
 * `deals.lost_reason` arrives with migration 043, which — like every
 * migration here — is written and handed over rather than applied. Until it
 * runs, the reason still has to go somewhere, so the write falls back to the
 * deal's notes and the feature works on the day it ships rather than on the
 * day the migration does.
 */
export function isUndefinedColumn(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /lost_reason/i.test(error.message ?? '');
}
