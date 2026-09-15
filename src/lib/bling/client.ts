import type { SupabaseClient } from '@supabase/supabase-js';

import { getAccessToken, type TokenDeps } from './connection';
import { BlingApiError, BlingConnectionError } from './errors';
import { blingFetch, type BlingCall } from './http';
import { blingOAuthConfig, type BlingOAuthConfig, type FetchLike } from './oauth';

/**
 * A porta de entrada para falar com o Bling em nome de uma conexão.
 *
 * Três coisas em ordem, toda vez:
 *
 *   1. um access token que vale (`connection.ts`, com a vez de renovar);
 *   2. uma ficha do balde (`bling_take_request`, 082) — esperar aqui é o que
 *      mantém o servidor abaixo dos 3 por segundo e longe do bloqueio de IP;
 *   3. a chamada (`http.ts`).
 *
 * E duas repetições, cada uma no máximo uma vez: um 401 renova o token e
 * repete (o token pode ter sido revogado antes de vencer); um 429 do segundo
 * espera um pouco mais que um segundo e repete. Um 429 do DIA não repete —
 * só amanhã resolve, e insistir gasta erro, que também bloqueia o IP.
 */

/** Quanto esperar pela ficha antes de desistir. */
const ESPERA_MAXIMA_DA_FICHA_MS = 10_000;

export interface ClientDeps {
  config?: BlingOAuthConfig;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /**
   * Chamado logo antes de cada ESCRITA (todo método que não é GET), depois
   * da ficha do limitador — e de novo antes de repetir a escrita por 401 ou
   * 429. A fila renova o lease aqui e lança `BlingLeaseLostError` se outro
   * processo pegou a operação (090): quem perdeu a vez não escreve.
   */
  beforeWrite?: () => Promise<void>;
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function blingRequest<T>(
  db: SupabaseClient,
  connectionId: string,
  path: string,
  call: BlingCall = {},
  deps: ClientDeps = {}
): Promise<T> {
  const config = deps.config ?? blingOAuthConfig();
  if (!config) {
    throw new BlingConnectionError('not_configured', 'o Bling não está configurado neste servidor');
  }
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? dormir;
  const tokenDeps: TokenDeps = { config, fetchImpl: deps.fetchImpl, sleep, now };

  let token = await getAccessToken(db, connectionId, tokenDeps);
  let jaRenovou = false;
  let jaEsperouOSegundo = false;

  const escrita = (call.method ?? 'GET') !== 'GET';

  for (;;) {
    await pegarFicha(db, connectionId, sleep, now);
    if (escrita && deps.beforeWrite) await deps.beforeWrite();
    const resultado = await blingFetch<T>(token, path, call, deps.fetchImpl);

    if (resultado.ok) {
      await anotarSucesso(db, connectionId, now());
      return resultado.data;
    }

    const erro = resultado.error;
    if (erro.isInvalidToken && !jaRenovou) {
      jaRenovou = true;
      token = await getAccessToken(db, connectionId, tokenDeps, token);
      continue;
    }
    if (erro.isRateLimited && erro.extra.period !== 'day' && !jaEsperouOSegundo) {
      jaEsperouOSegundo = true;
      await sleep(1_100);
      continue;
    }
    throw erro;
  }
}

async function pegarFicha(
  db: SupabaseClient,
  connectionId: string,
  sleep: (ms: number) => Promise<void>,
  now: () => number
): Promise<void> {
  const limite = now() + ESPERA_MAXIMA_DA_FICHA_MS;
  for (;;) {
    const { data, error } = await db.rpc('bling_take_request', {
      p_connection_id: connectionId,
    });
    if (error) {
      // Sem limitador não se chama o Bling: chamar às cegas é o caminho
      // mais curto para o bloqueio de IP.
      throw new BlingConnectionError(
        'limiter_unavailable',
        `o limitador de requisições não respondeu: ${error.message}`
      );
    }

    const espera = Number(data);
    if (espera === 0) return;
    if (espera < 0) {
      throw new BlingApiError(429, 'daily_limit', 'o limite diário de requisições ao Bling acabou', {
        period: 'day',
      });
    }
    if (!Number.isFinite(espera) || now() + espera > limite) {
      throw new BlingApiError(429, 'rate_wait', 'fila de requisições ao Bling cheia', {
        period: 'second',
      });
    }
    await sleep(espera);
  }
}

/**
 * `last_success_at`, no máximo uma vez por minuto.
 *
 * É o "última resposta do Bling" da tela. Gravar a cada chamada seria uma
 * escrita por requisição numa linha que o limitador tranca com `FOR UPDATE`.
 */
async function anotarSucesso(db: SupabaseClient, connectionId: string, agora: number) {
  const umMinutoAtras = new Date(agora - 60_000).toISOString();
  await db
    .from('bling_connections')
    .update({ last_success_at: new Date(agora).toISOString() })
    .eq('id', connectionId)
    .or(`last_success_at.is.null,last_success_at.lt.${umMinutoAtras}`);
}
