import type { SupabaseClient } from '@supabase/supabase-js';

import type { ClientDeps } from './client';
import { describeBlingFailure } from './errors';
import { finishSync } from './jobs';
import { importProducts, type ImportOptions } from './products';
import { syncReferences } from './references';

/**
 * Os trabalhos longos, do jeito que a rota e o cron os disparam: DEPOIS de
 * pegar a vez (`claimSync`), dentro de `after()`, e sempre terminando com
 * `finishSync` — a vez presa sem isso só volta em 15 minutos.
 */

export interface RunConnection {
  id: string;
  account_id: string;
  company_id: string;
}

export async function runReferencesSync(
  db: SupabaseClient,
  conexao: RunConnection,
  deps: ClientDeps = {}
): Promise<void> {
  try {
    const { data: settings } = await db
      .from('bling_settings')
      .select('company_id, order_module_id')
      .eq('account_id', conexao.account_id)
      .maybeSingle();
    const s = settings as { company_id: string; order_module_id: string | null } | null;
    // O módulo confirmado para OUTRA empresa não serve nem para buscar.
    const moduloConfirmado = s && s.company_id === conexao.company_id ? s.order_module_id : null;

    const relatorio = await syncReferences(db, conexao, { orderModuleId: moduloConfirmado }, deps);
    const falhas = Object.values(relatorio).filter((r) => r?.error).length;
    await finishSync(db, conexao.id, 'references', {
      status: falhas === 0 ? 'ok' : 'partial',
      error: falhas === 0 ? null : `${falhas} tipo(s) de cadastro com erro`,
      stats: relatorio,
    });
  } catch (erro) {
    const falha = describeBlingFailure(erro);
    console.error('[bling] sincronização dos cadastros falhou:', falha);
    await finishSync(db, conexao.id, 'references', {
      status: 'error',
      error: falha.message,
      stats: { code: falha.code },
    });
  }
}

/**
 * A importação de produtos. `partial` quando sobrou produto para a próxima
 * rodada (teto de detalhe) ou alguma gravação falhou — o cron volta antes.
 */
export async function runProductsImport(
  db: SupabaseClient,
  conexao: RunConnection,
  deps: ClientDeps = {},
  opcoes: ImportOptions = {}
): Promise<void> {
  try {
    const stats = await importProducts(db, conexao, deps, opcoes);
    const incompleto = stats.remaining > 0 || stats.writeErrors > 0;
    await finishSync(db, conexao.id, 'products', {
      status: incompleto ? 'partial' : 'ok',
      error: stats.writeErrors > 0 ? `${stats.writeErrors} gravação(ões) falharam` : null,
      stats: { ...stats },
    });
  } catch (erro) {
    const falha = describeBlingFailure(erro);
    console.error('[bling] importação de produtos falhou:', falha);
    await finishSync(db, conexao.id, 'products', {
      status: 'error',
      error: falha.message,
      stats: { code: falha.code },
    });
  }
}

/**
 * Quanto a importação de produtos pode esperar: dez minutos quando a última
 * rodada deixou produto para trás, um dia quando terminou.
 */
export function productsMaxAgeMs(stats: Record<string, unknown> | null | undefined): number {
  const restante = typeof stats?.remaining === 'number' ? stats.remaining : 0;
  return restante > 0 ? 10 * 60_000 : 24 * 60 * 60_000;
}
