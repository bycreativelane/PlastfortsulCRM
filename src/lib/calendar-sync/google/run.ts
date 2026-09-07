import type { SupabaseClient } from '@supabase/supabase-js';

import { GoogleApiError } from './client';
import { syncSource, type ConnectionRow, type SourceRow } from './events';

/**
 * Uma passada de importação — o miolo que o cron e o botão compartilham.
 *
 * As duas entradas ("sincronizar agora" e o tique de cinco minutos) fazem
 * exatamente a mesma coisa e diferem só em quem pode chamá-las e em que
 * fontes escolhem. Escrever isso duas vezes seria manter duas cópias de
 * uma regra de erro em sincronia — e a regra de erro é a parte difícil.
 *
 * ------------------------------------------------------------------
 * UMA FONTE QUE FALHA NÃO DERRUBA AS OUTRAS
 * ------------------------------------------------------------------
 *
 * Cada fonte é isolada. Uma agenda cujo acesso foi revogado, uma que
 * estourou cota, uma que a Google devolveu 500 — nenhuma pode custar as
 * demais, porque o resultado seria uma integração que para inteira por
 * causa da agenda de feriados de alguém.
 *
 * O erro fica gravado em `last_error` da própria fonte, que é onde a tela
 * o mostra: um erro só no log é um erro que ninguém vê.
 */

export interface RunOutcome {
  synced: number;
  failed: number;
  imported: number;
  removed: number;
}

export async function runSync(
  db: SupabaseClient,
  connection: ConnectionRow,
  sources: SourceRow[]
): Promise<RunOutcome> {
  const outcome: RunOutcome = { synced: 0, failed: 0, imported: 0, removed: 0 };

  for (const source of sources) {
    try {
      const result = await syncSource(db, connection, source);
      outcome.synced += 1;
      outcome.imported += result.imported;
      outcome.removed += result.removed;
    } catch (error) {
      outcome.failed += 1;
      await recordFailure(db, connection, source, error);
    }
  }

  return outcome;
}

/**
 * Grava a falha onde ela é visível, e decide quando tentar de novo.
 *
 * Um erro transitório (429, 5xx) volta em cinco minutos como qualquer
 * outra fonte. Um permanente — escopo faltando, acesso revogado — recua
 * para uma hora: repetir de cinco em cinco minutos um erro que não vai
 * mudar sozinho é gastar cota para produzir a mesma mensagem.
 *
 * Um 401 que sobreviveu à renovação significa que a autorização foi
 * revogada do lado da Google, e aí a CONEXÃO inteira muda de estado — não
 * só a fonte. É a diferença entre "esta agenda deu problema" e "alguém
 * desconectou o CRM", e a tela precisa dizer a segunda coisa quando é ela.
 */
async function recordFailure(
  db: SupabaseClient,
  connection: ConnectionRow,
  source: SourceRow,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const transient = error instanceof GoogleApiError && error.isTransient;
  const revoked = error instanceof GoogleApiError && error.isExpiredToken;

  const backoffMinutes = transient ? 5 : 60;

  await db
    .from('calendar_sources')
    .update({
      last_error: message.slice(0, 500),
      next_poll_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', source.id);

  if (revoked) {
    await db
      .from('calendar_connections')
      .update({
        status: 'revoked',
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id);
  }

  console.error(`[calendar] fonte ${source.external_id} falhou:`, message);
}

/** A conexão de uma conta, com os campos que o sync precisa. */
export async function loadConnection(
  db: SupabaseClient,
  accountId: string
): Promise<ConnectionRow | null> {
  const { data } = await db
    .from('calendar_connections')
    .select('id, account_id, refresh_token, access_token, access_expires_at')
    .eq('account_id', accountId)
    .eq('provider', 'google')
    .eq('status', 'connected')
    .maybeSingle();

  return (data as ConnectionRow | null) ?? null;
}

/** As fontes que importam desta conexão. */
export async function loadImportableSources(
  db: SupabaseClient,
  connectionId: string,
  options: { onlyDue?: boolean } = {}
): Promise<SourceRow[]> {
  let query = db
    .from('calendar_sources')
    .select('id, account_id, connection_id, external_id, sync_token')
    .eq('connection_id', connectionId)
    .eq('enabled', true)
    // 'out' publica e não importa — puxá-la seria trabalho para descartar.
    .in('direction', ['in', 'both']);

  if (options.onlyDue) {
    query = query.or(
      `next_poll_at.is.null,next_poll_at.lte.${new Date().toISOString()}`
    );
  }

  const { data } = await query.limit(50);
  return (data ?? []) as SourceRow[];
}
