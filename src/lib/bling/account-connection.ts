import type { SupabaseClient } from '@supabase/supabase-js';

import { isMissingBlingTable } from './status';

/**
 * A conexão Bling de uma conta, do jeito que as rotas de admin precisam: sem
 * tokens, e distinguindo "a 082 não está no banco" de "a conta não conectou".
 */

export interface AccountConnection {
  id: string;
  account_id: string;
  company_id: string;
  company_name: string | null;
  status: 'connected' | 'revoked' | 'error';
}

export type AccountConnectionResult =
  | { state: 'pending' }
  | { state: 'none' }
  | { state: 'ok'; connection: AccountConnection };

export async function loadAccountConnection(
  db: SupabaseClient,
  accountId: string
): Promise<AccountConnectionResult> {
  const { data, error } = await db
    .from('bling_connections')
    .select('id, account_id, company_id, company_name, status')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    if (isMissingBlingTable(error)) return { state: 'pending' };
    throw new Error(`[bling] não consegui ler a conexão: ${error.message}`);
  }
  if (!data) return { state: 'none' };
  return { state: 'ok', connection: data as AccountConnection };
}

/** Uma tabela ou função de uma migração que ainda não foi aplicada. */
export function isMissingObject(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ['PGRST205', '42P01', 'PGRST202', '42883'].includes(error.code ?? '');
}
