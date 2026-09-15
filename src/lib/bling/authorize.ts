import crypto from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';

import { describeBlingFailure } from './errors';
import { blingFetch, parseCompany, type BlingCompany } from './http';
import {
  exchangeCode,
  revokeToken,
  type BlingOAuthConfig,
  type BlingTokens,
  type FetchLike,
  accessExpiresAt,
} from './oauth';

/**
 * O que acontece no callback depois que o `state` foi conferido.
 *
 * Mora aqui, e não na rota, para poder ser testado sem Next: é a parte do
 * fluxo em que um erro de ordem custa a conexão.
 *
 * ------------------------------------------------------------------
 * A ORDEM
 * ------------------------------------------------------------------
 *
 *   1. grava o hash do código — antes de qualquer chamada ao Bling. O
 *      segundo acerto do mesmo callback cai no UNIQUE e para aqui, porque
 *      trocar o mesmo código duas vezes REVOGA o usuário no Bling;
 *   2. troca o código pelos tokens;
 *   3. pergunta ao Bling qual é a empresa (`/empresas/me/dados-basicos`);
 *   4. se a conta já está ligada a OUTRA empresa, recusa: nas próximas fases
 *      produtos, contatos e pedidos guardam ids daquela empresa, e trocar por
 *      baixo deles mistura dois ERPs. Desconectar primeiro é a porta;
 *   5. grava a conexão, com os dois tokens cifrados.
 *
 * Qualquer autorização obtida e não gravada é revogada no Bling na hora
 * (melhor esforço): uma autorização órfã continua valendo lá por 30 dias.
 */

export type BlingCallbackOutcome =
  | 'connected'
  | 'duplicate'
  | 'exchange_failed'
  | 'company_failed'
  | 'company_mismatch'
  | 'company_in_use'
  | 'save_failed';

export interface CompleteAuthorizationInput {
  accountId: string;
  userId: string;
  code: string;
  config: BlingOAuthConfig;
}

export interface CompleteAuthorizationDeps {
  db: SupabaseClient;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export interface CompleteAuthorizationResult {
  outcome: BlingCallbackOutcome;
  company?: BlingCompany;
  reconnected?: boolean;
  scopes?: number;
}

/** O código nunca é gravado: só o SHA-256 dele. */
export function hashAuthorizationCode(code: string): string {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

const UM_DIA_MS = 86_400_000;

export async function completeAuthorization(
  input: CompleteAuthorizationInput,
  deps: CompleteAuthorizationDeps
): Promise<CompleteAuthorizationResult> {
  const { db, fetchImpl } = deps;
  const now = deps.now ?? Date.now;

  // 1. Uma vez só.
  const { error: jaTrocado } = await db
    .from('bling_oauth_codes')
    .insert({ code_hash: hashAuthorizationCode(input.code), account_id: input.accountId });
  if (jaTrocado) {
    if (jaTrocado.code === '23505') return { outcome: 'duplicate' };
    console.error('[bling] não consegui reservar o código de autorização:', jaTrocado.message);
    return { outcome: 'save_failed' };
  }
  // O código vale um minuto; um dia de folga é só para não apagar o de agora.
  await db
    .from('bling_oauth_codes')
    .delete()
    .lt('created_at', new Date(now() - UM_DIA_MS).toISOString());

  // 2. Os tokens.
  let tokens: BlingTokens;
  try {
    tokens = await exchangeCode(input.config, input.code, fetchImpl);
  } catch (erro) {
    console.error('[bling] a troca do código falhou:', describeBlingFailure(erro));
    return { outcome: 'exchange_failed' };
  }

  const descartar = () => revokeToken(input.config, tokens.refreshToken, 'refresh_token', fetchImpl);

  // 3. A empresa.
  const resposta = await blingFetch<unknown>(
    tokens.accessToken,
    '/empresas/me/dados-basicos',
    {},
    fetchImpl
  );
  const company = resposta.ok ? parseCompany(resposta.data) : null;
  if (!company) {
    console.error(
      '[bling] conectou, mas os dados básicos da empresa não vieram:',
      resposta.ok ? 'resposta sem data.id' : describeBlingFailure(resposta.error)
    );
    await descartar();
    return { outcome: 'company_failed' };
  }

  // 4. Outra empresa?
  const { data: existente, error: erroLeitura } = await db
    .from('bling_connections')
    .select('id, company_id, status')
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (erroLeitura) {
    console.error('[bling] não consegui ler a conexão atual:', erroLeitura.message);
    await descartar();
    return { outcome: 'save_failed' };
  }
  if (existente && existente.status !== 'revoked' && existente.company_id !== company.id) {
    await descartar();
    return { outcome: 'company_mismatch', company };
  }

  // A mesma empresa do Bling já conectada em OUTRA conta do CRM: o webhook
  // acha a conta pelo `companyId`, e duas conexões vivas da mesma empresa
  // fariam os eventos de uma caírem na outra (ou em nenhuma). A 090 tem o
  // índice único; esta pergunta é para responder com o motivo.
  const { data: outra, error: erroOutra } = await db
    .from('bling_connections')
    .select('account_id')
    .eq('company_id', company.id)
    .neq('status', 'revoked')
    .neq('account_id', input.accountId)
    .limit(1);
  if (erroOutra) {
    console.error('[bling] não consegui conferir a empresa em outras contas:', erroOutra.message);
    await descartar();
    return { outcome: 'save_failed' };
  }
  if ((outra ?? []).length > 0) {
    await descartar();
    return { outcome: 'company_in_use', company };
  }

  // 5. Grava.
  const agora = new Date(now()).toISOString();
  const { error: erroGravacao } = await db.from('bling_connections').upsert(
    {
      account_id: input.accountId,
      connected_by: input.userId,
      company_id: company.id,
      company_name: company.name,
      company_cnpj: company.cnpj,
      scopes: tokens.scopes,
      refresh_token: encrypt(tokens.refreshToken),
      access_token: encrypt(tokens.accessToken),
      access_expires_at: accessExpiresAt(tokens.expiresIn, now()),
      refresh_issued_at: agora,
      status: 'connected',
      last_error: null,
      last_error_at: null,
      consecutive_failures: 0,
      // A pergunta da empresa acabou de dar certo.
      last_success_at: agora,
      refresh_lock_token: null,
      refresh_lock_until: null,
      refresh_attempted_at: null,
      connected_at: agora,
      updated_at: agora,
    },
    { onConflict: 'account_id' }
  );
  if (erroGravacao) {
    await descartar();
    // A corrida com outra conta conectando a mesma empresa: o índice da 090.
    if (erroGravacao.code === '23505') return { outcome: 'company_in_use', company };
    console.error('[bling] não consegui gravar a conexão:', erroGravacao.message);
    return { outcome: 'save_failed' };
  }

  return {
    outcome: 'connected',
    company,
    reconnected: Boolean(existente),
    scopes: tokens.scopes.length,
  };
}
