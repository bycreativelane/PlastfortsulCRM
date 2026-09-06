import type { SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_TIMEZONE, safeTimeZone } from './local-time';

/**
 * O fuso em que uma conta vive.
 *
 * Até a 066 isto era `DEFAULT_TIMEZONE`, uma constante — e o comentário dela
 * dizia exatamente por quê: "There is no per-account zone in the schema".
 * Agora há, e esta função é a fronteira entre a coluna e o motor.
 *
 * A PRECEDÊNCIA IMPORTA, e é deliberadamente esta: o que a automação declarou
 * ganha, o fuso da conta vem depois, a constante é o último recurso. Uma
 * automação que já foi salva com `timezone` continua exatamente como estava
 * — a 066 não pode mudar a hora de um follow-up que alguém configurou à mão
 * — e uma que nunca declarou nada passa a seguir a empresa em vez de seguir
 * São Paulo por acaso.
 *
 * SEM CACHE. Uma consulta por chave primária, algumas vezes por tique de
 * cron, é barata; um cache com validade seria a única coisa aqui capaz de
 * mandar uma mensagem no fuso antigo depois de alguém ter corrigido o fuso.
 */
export async function accountTimeZone(
  db: SupabaseClient,
  accountId: string | null | undefined
): Promise<string> {
  if (!accountId) return DEFAULT_TIMEZONE;

  const { data, error } = await db
    .from('accounts')
    .select('timezone')
    .eq('id', accountId)
    .maybeSingle();

  // A 066 pode não ter rodado — as migrações deste projeto são aplicadas à
  // mão, de propósito. Enquanto a coluna não existe, o motor se comporta
  // exatamente como se comportava antes dela.
  if (error || !data) return DEFAULT_TIMEZONE;

  return safeTimeZone((data as { timezone?: string | null }).timezone);
}

/**
 * O fuso a usar, dado o que a automação declarou.
 *
 * Açúcar para a precedência acima, para que os pontos de chamada não a
 * reescrevam — e discordem — cada um do seu jeito.
 */
export async function resolveTimeZone(
  db: SupabaseClient,
  accountId: string | null | undefined,
  configured?: string | null
): Promise<string> {
  if (configured) return safeTimeZone(configured);
  return accountTimeZone(db, accountId);
}
