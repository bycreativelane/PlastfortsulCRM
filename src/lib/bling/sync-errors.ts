/**
 * OS ERROS DO PEDIDO NO BLING, EM FRASE — o que a fila grava em
 * `deals.sync_error` e `bling_operations.error`, e o que as rotas respondem.
 *
 * Fora do componente para ser testado: `sync-errors.test.ts` confere que todo
 * código que o servidor escreve tem frase nas três línguas — um código novo
 * sem frase chegava ao vendedor como `order_not_synced` num toast.
 */

/**
 * A mensagem de erro gravada pela fila, na língua de quem lê.
 *
 * Os códigos do CRM (`contact_ambiguous`, `payload:no_category,…`) viram
 * frase; o que o Bling disse (`bling:400:…`) vai como veio, sem o prefixo.
 */
export function describeSyncError(
  erro: string,
  t: (chave: string, valores?: Record<string, string | number>) => string
): string {
  if (erro.startsWith('bling:')) {
    const [, status, ...resto] = erro.split(':');
    return t('errors.bling', { status, detail: resto.join(':') });
  }
  if (erro.startsWith('payload:')) {
    return erro
      .slice('payload:'.length)
      .split(',')
      .map((codigo) => (PAYLOAD_PROBLEM_CODES.has(codigo) ? t(`errors.payload.${codigo}`) : codigo))
      .join(' ');
  }
  if (erro.startsWith('diff:')) {
    return t('errors.diff', { fields: erro.slice('diff:'.length) });
  }
  // Um código que esta lista não conhece vira frase com o código entre
  // parênteses — nunca o código cru no lugar da frase.
  return SYNC_ERROR_CODES.has(erro) ? t(`errors.${erro}`) : t('errors.unknown', { code: erro });
}

export const SYNC_ERROR_CODES: ReadonlySet<string> = new Set([
  // As recusas das rotas (antes de ir para a fila).
  'order_locked',
  'order_not_open',
  'order_not_synced',
  'not_found',
  'enqueue_failed',
  'invalid_transition',
  'not_created',
  'invalid_body',
  // Da fila.
  'accounts_not_reversed',
  'abandoned',
  'lease_lost',
  'deal_missing',
  'no_id_returned',
  'save_key_failed',
  'orders_disabled',
  'not_connected',
  'company_mismatch',
  'contact_document_missing',
  'contact_ambiguous',
  'contact_link_broken',
  'order_not_created',
  'order_launched',
  'duplicate_remote',
  'remote_not_open',
  'remote_missing',
  'daily_limit',
  'unexpected',
  'refresh_busy',
  'refresh_throttled',
  'limiter_unavailable',
  'revoked',
  'not_configured',
  'invalid_status',
  'status_not_mapped',
  'transition_not_allowed',
  'remote_status_mismatch',
]);

export const PAYLOAD_PROBLEM_CODES: ReadonlySet<string> = new Set([
  'no_contact',
  'no_items',
  'item_not_linked',
  'no_category',
  'no_installments',
  'installment_without_method',
  'installment_without_due',
  'installments_mismatch',
  'no_open_status',
  'invalid_id',
]);
