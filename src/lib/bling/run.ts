import type { SupabaseClient } from '@supabase/supabase-js';

import type { ClientDeps } from './client';
import { describeBlingFailure } from './errors';
import { finishSync } from './jobs';
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
