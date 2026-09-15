import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

import { BlingApiError, BlingConnectionError } from './errors';
import {
  accessExpiresAt,
  isAccessValid,
  networkError,
  refreshTokens,
  type BlingOAuthConfig,
  type FetchLike,
} from './oauth';

/**
 * O access token de uma conexão, renovado por um só de cada vez.
 *
 * ------------------------------------------------------------------
 * POR QUE A RENOVAÇÃO TEM DONO
 * ------------------------------------------------------------------
 *
 * O Bling não documenta se o refresh token muda a cada renovação. Se muda,
 * duas renovações com o mesmo refresh token têm um perdedor, e o perdedor
 * grava por cima do vencedor um token que já não vale: a conexão cai, e cai
 * de um jeito que parece revogação. E 20 chamadas a /oauth/token num minuto
 * bloqueiam o IP do servidor por uma hora.
 *
 * Então: quem precisa renovar pede a vez a `bling_claim_refresh()` (082). Só
 * um recebe, por 30 segundos, no máximo uma vez por minuto. Quem não recebeu
 * espera o dono gravar e lê o token novo. O dono relê a linha depois de pegar
 * a vez — alguém pode ter terminado de renovar entre a leitura e o pedido.
 *
 * ------------------------------------------------------------------
 * GRAVA SEMPRE O REFRESH QUE VOLTAR, E SÓ POR CIMA DO QUE FOI USADO
 * ------------------------------------------------------------------
 *
 * A gravação filtra pelo refresh token cifrado que foi lido. Se ele mudou
 * no meio — o dono perdeu a vez por demora e outro renovou —, a gravação
 * não acontece: o token deste chamador serve para esta chamada, mas não
 * passa por cima de um mais novo.
 *
 * ------------------------------------------------------------------
 * UMA RENOVAÇÃO QUE FALHA MARCA A CONEXÃO
 * ------------------------------------------------------------------
 *
 * A Google não marca, e o plano registra por que não copiar. Aqui um refresh
 * recusado pelo Bling (401, `invalid_grant`, empresa inativa) põe a conexão
 * em `revoked` e a tela pede para conectar de novo. Falhas passageiras
 * contam; três seguidas viram `error`, com a última mensagem.
 */

const ESPERA_PELO_DONO_MS = 35_000;
const PASSO_DA_ESPERA_MS = 500;
const FALHAS_ATE_ERRO = 3;

const COLUNAS =
  'id, account_id, status, access_token, access_expires_at, refresh_token, refresh_lock_until, consecutive_failures';

interface LinhaDeToken {
  id: string;
  account_id: string;
  status: 'connected' | 'revoked' | 'error';
  access_token: string | null;
  access_expires_at: string | null;
  refresh_token: string;
  refresh_lock_until: string | null;
  consecutive_failures: number;
}

export interface TokenDeps {
  config: BlingOAuthConfig;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function lerLinha(db: SupabaseClient, id: string): Promise<LinhaDeToken | null> {
  const { data, error } = await db
    .from('bling_connections')
    .select(COLUNAS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[bling] não consegui ler a conexão: ${error.message}`);
  return (data as LinhaDeToken | null) ?? null;
}

/** O token decifrado, se ainda vale e não é o que acabou de levar 401. */
function utilizavel(
  linha: LinhaDeToken,
  agora: number,
  recusado: string | undefined
): string | null {
  if (!linha.access_token || !isAccessValid(linha.access_expires_at, agora)) return null;
  const token = decrypt(linha.access_token);
  return recusado && token === recusado ? null : token;
}

/**
 * Um refresh que o Bling recusou por não valer mais — não por estar fora do
 * ar. `invalid_grant` é o refresh vencido ou inválido; `UNAUTHORIZED_ERROR`
 * é "empresa inativa". `invalid_client` NÃO entra: são as credenciais do
 * servidor, e a autorização continua boa depois de alguém consertar o `.env`.
 */
export function refreshRevokesConnection(erro: BlingApiError): boolean {
  if (erro.status === 401) return true;
  const tipo = erro.type.toLowerCase();
  return (
    erro.status === 400 &&
    ['invalid_grant', 'invalid_token', 'unauthorized_error', 'unauthorized', 'unauthenticated'].includes(tipo)
  );
}

/**
 * Devolve um access token que vale agora.
 *
 * `recusado` é o token que acabou de levar 401: mesmo que a linha diga que
 * ele ainda vale, ele não serve, e a renovação é forçada — a menos que outro
 * processo já tenha trocado o token por um diferente.
 */
export async function getAccessToken(
  db: SupabaseClient,
  connectionId: string,
  deps: TokenDeps,
  recusado?: string
): Promise<string> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? dormir;
  const limite = now() + ESPERA_PELO_DONO_MS;

  for (;;) {
    const linha = await lerLinha(db, connectionId);
    if (!linha) throw new BlingConnectionError('not_connected', 'a conta não está conectada ao Bling');
    if (linha.status === 'revoked') {
      throw new BlingConnectionError('revoked', 'o Bling revogou a autorização; conecte de novo');
    }

    const pronto = utilizavel(linha, now(), recusado);
    if (pronto) return pronto;

    const { data: vez, error } = await db.rpc('bling_claim_refresh', {
      p_connection_id: connectionId,
    });
    if (error) throw new Error(`[bling] não consegui pedir a vez de renovar: ${error.message}`);

    if (typeof vez === 'string' && vez) {
      const dono = await lerLinha(db, connectionId);
      if (!dono) throw new BlingConnectionError('not_connected', 'a conta não está conectada ao Bling');
      const jaRenovado = utilizavel(dono, now(), recusado);
      if (jaRenovado) {
        await soltarVez(db, connectionId, vez);
        return jaRenovado;
      }
      return renovar(db, dono, vez, deps);
    }

    // Sem a vez. Relê: pode ser que o dono tenha acabado de gravar.
    const depois = await lerLinha(db, connectionId);
    if (!depois) throw new BlingConnectionError('not_connected', 'a conta não está conectada ao Bling');
    const renovadoPorOutro = utilizavel(depois, now(), recusado);
    if (renovadoPorOutro) return renovadoPorOutro;

    const alguemRenovando =
      depois.refresh_lock_until !== null && Date.parse(depois.refresh_lock_until) > now();
    if (!alguemRenovando) {
      // Ninguém com a vez, e mesmo assim ela foi negada: a última tentativa
      // foi há menos de um minuto. Insistir é o que bloqueia o IP.
      throw new BlingConnectionError(
        'refresh_throttled',
        'a última renovação foi há menos de um minuto; tente de novo em instantes'
      );
    }
    if (now() >= limite) {
      throw new BlingConnectionError('refresh_busy', 'a renovação do token não terminou a tempo');
    }
    await sleep(PASSO_DA_ESPERA_MS);
  }
}

async function soltarVez(db: SupabaseClient, id: string, vez: string): Promise<void> {
  await db
    .from('bling_connections')
    .update({ refresh_lock_token: null, refresh_lock_until: null })
    .eq('id', id)
    .eq('refresh_lock_token', vez);
}

async function renovar(
  db: SupabaseClient,
  linha: LinhaDeToken,
  vez: string,
  deps: TokenDeps
): Promise<string> {
  const now = deps.now ?? Date.now;
  const refreshUsado = decrypt(linha.refresh_token);

  let tokens;
  try {
    tokens = await refreshTokens(deps.config, refreshUsado, deps.fetchImpl);
  } catch (falha) {
    const erro = falha instanceof BlingApiError ? falha : networkError(falha);
    const revogou = refreshRevokesConnection(erro);
    const falhas = linha.consecutive_failures + 1;
    await db
      .from('bling_connections')
      .update({
        status: revogou ? 'revoked' : falhas >= FALHAS_ATE_ERRO ? 'error' : linha.status,
        last_error: erro.detail,
        last_error_at: new Date(now()).toISOString(),
        consecutive_failures: falhas,
        refresh_lock_token: null,
        refresh_lock_until: null,
        updated_at: new Date(now()).toISOString(),
      })
      .eq('id', linha.id)
      .eq('refresh_lock_token', vez);
    if (revogou) {
      throw new BlingConnectionError('revoked', `o Bling recusou a renovação: ${erro.detail}`);
    }
    throw erro;
  }

  const agora = new Date(now()).toISOString();
  const { data, error } = await db
    .from('bling_connections')
    .update({
      access_token: encrypt(tokens.accessToken),
      refresh_token: encrypt(tokens.refreshToken),
      access_expires_at: accessExpiresAt(tokens.expiresIn, now()),
      // Só um refresh token DIFERENTE reinicia os 30 dias: é assim que a
      // tela mostra a validade certa e que a homologação vê se ele gira.
      ...(tokens.refreshToken !== refreshUsado ? { refresh_issued_at: agora } : {}),
      ...(tokens.scopes.length > 0 ? { scopes: tokens.scopes } : {}),
      status: 'connected',
      last_error: null,
      last_error_at: null,
      consecutive_failures: 0,
      last_success_at: agora,
      refresh_lock_token: null,
      refresh_lock_until: null,
      updated_at: agora,
    })
    .eq('id', linha.id)
    .eq('refresh_token', linha.refresh_token)
    .select('id');

  if (error || !Array.isArray(data) || data.length === 0) {
    // O token novo vale para esta chamada; só não foi guardado. Se o Bling
    // gira o refresh token, o guardado pode ter deixado de valer — é o tipo
    // de coisa que precisa aparecer no log com o nome da conexão.
    console.error(
      `[bling] conexão ${linha.id}: token renovado sem gravar (${error ? error.message : 'o refresh token mudou no meio'})`
    );
    await soltarVez(db, linha.id, vez);
  }
  return tokens.accessToken;
}
