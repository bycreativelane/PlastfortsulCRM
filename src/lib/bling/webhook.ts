import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { blingRequest, type ClientDeps } from './client';
import { BlingApiError } from './errors';
import type { BlingSettingsRow } from './health';
import { applyRemoteOrder, summarizeRemoteOrder } from './reconcile';

/**
 * O WEBHOOK DO BLING (Fase 6) — receber rápido, processar depois.
 *
 * 1. `request.text()` — a assinatura é do corpo CRU; reserializar o JSON
 *    mudaria um espaço e a assinatura não bateria.
 * 2. HMAC-SHA256 com o client secret, comparado em tempo constante com
 *    `X-Bling-Signature-256: sha256=<hex>` (documentação de webhooks).
 * 3. `companyId` → conexão.
 * 4. INSERT em `bling_webhook_events` antes do 2xx; `event_id` repetido é a
 *    mesma linha e também recebe 2xx (idempotência que o Bling pede).
 * 5. Responde em bem menos de 5 s; o processamento é do `after()` e do cron.
 */

export function verifyBlingSignature(corpo: string, cabecalho: string | null, segredo: string): boolean {
  if (!cabecalho || !segredo) return false;
  const m = cabecalho.trim().match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  const esperado = createHmac('sha256', segredo).update(corpo, 'utf8').digest();
  const recebido = Buffer.from(m[1], 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export interface WebhookEnvelope {
  eventId: string;
  date: string | null;
  event: string;
  companyId: string;
  data: Record<string, unknown>;
}

export function parseWebhook(corpo: string): WebhookEnvelope | null {
  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const event = texto(o.event);
  const companyId = texto(o.companyId);
  if (!event || !companyId) return null;
  // Sem eventId (não deveria acontecer), o resumo do corpo faz as vezes: a
  // mesma entrega repetida continua sendo uma linha só.
  const eventId = texto(o.eventId) ?? `sha256:${createHash('sha256').update(corpo).digest('hex')}`;
  return {
    eventId: eventId.slice(0, 200),
    date: texto(o.date),
    event: event.slice(0, 80),
    companyId,
    data: o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {},
  };
}

/** Só ids e números — nunca nome, documento, endereço ou telefone (LGPD). */
export function webhookSummary(env: WebhookEnvelope): { resourceId: string | null; summary: Record<string, unknown> } {
  const id = env.data.id;
  const resourceId = id === undefined || id === null ? null : String(id);
  if (env.event.startsWith('order.')) {
    const pedido = summarizeRemoteOrder(env.data);
    return { resourceId, summary: pedido ? { ...pedido } : {} };
  }
  return { resourceId, summary: resourceId ? { id: resourceId } : {} };
}

export type ReceiveResult =
  | { status: 401; body: { error: 'invalid_signature' } }
  | { status: 400; body: { error: 'invalid_payload' } }
  | { status: 200; body: { ignored: 'unknown_company' } | { duplicate: true } | { accepted: true; id: string } };

export async function receiveWebhook(
  db: SupabaseClient,
  corpo: string,
  assinatura: string | null,
  segredo: string,
  now: () => number = Date.now
): Promise<ReceiveResult> {
  if (!verifyBlingSignature(corpo, assinatura, segredo)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }
  const env = parseWebhook(corpo);
  if (!env) return { status: 400, body: { error: 'invalid_payload' } };

  const { data: conexao, error: erroConexao } = await db
    .from('bling_connections')
    .select('id, account_id')
    .eq('company_id', env.companyId)
    .neq('status', 'revoked')
    .maybeSingle();
  // Uma falha de leitura não é "empresa desconhecida": 500, e o Bling
  // retenta. (Duas conexões vivas da mesma empresa não existem desde a 090.)
  if (erroConexao) throw new Error(`[bling] não consegui achar a conexão do webhook: ${erroConexao.message}`);
  // Empresa que ninguém conectou: 2xx assim mesmo. Um erro faria o Bling
  // retentar por três dias e desabilitar o webhook do aplicativo inteiro.
  if (!conexao) return { status: 200, body: { ignored: 'unknown_company' } };
  const c = conexao as { id: string; account_id: string };

  const { resourceId, summary } = webhookSummary(env);
  const ocorrido = env.date && !Number.isNaN(Date.parse(env.date)) ? new Date(env.date).toISOString() : null;
  const { data, error } = await db
    .from('bling_webhook_events')
    .insert({
      event_id: env.eventId,
      account_id: c.account_id,
      connection_id: c.id,
      company_id: env.companyId,
      event: env.event,
      resource_id: resourceId,
      occurred_at: ocorrido,
      summary,
    })
    .select('id')
    .single();

  await db.from('bling_connections').update({ last_webhook_at: new Date(now()).toISOString() }).eq('id', c.id);

  if (error) {
    if (error.code === '23505') return { status: 200, body: { duplicate: true } };
    throw new Error(`[bling] não consegui gravar o webhook: ${error.message}`);
  }
  return { status: 200, body: { accepted: true, id: (data as { id: string }).id } };
}

interface EventoLinha {
  id: string;
  account_id: string | null;
  connection_id: string | null;
  event: string;
  resource_id: string | null;
  summary: Record<string, unknown>;
}

/** Uma linha do claim: `{ id, lock_token }` desde a 090 (a 089 devolvia só o id). */
function lerPega(bruto: unknown): { id: string; lockToken: string | null } | null {
  if (typeof bruto === 'string') return { id: bruto, lockToken: null };
  if (!bruto || typeof bruto !== 'object') return null;
  const o = bruto as { id?: unknown; lock_token?: unknown; bling_claim_webhook_events?: unknown };
  const id = typeof o.id === 'string' ? o.id : typeof o.bling_claim_webhook_events === 'string' ? o.bling_claim_webhook_events : null;
  if (!id) return null;
  return { id, lockToken: typeof o.lock_token === 'string' ? o.lock_token : null };
}

/**
 * Processa eventos pegos com lease, UM de cada vez: um específico (after) ou
 * os pendentes (cron), até `limit`. Cada um com lease próprio, e o término
 * com compare-and-set pelo `lock_token` (090): um processo que demorou mais
 * que o lease não sobrescreve o que o outro gravou.
 */
export async function processWebhookEvents(
  db: SupabaseClient,
  alvo: { eventRowId?: string | null; limit?: number },
  opcoes: { deps?: ClientDeps; now?: () => number } = {}
): Promise<number> {
  const limite = alvo.eventRowId ? 1 : Math.max(1, Math.min(alvo.limit ?? 20, 100));
  let feitos = 0;

  for (let volta = 0; volta < limite; volta++) {
    const { data, error } = await db.rpc('bling_claim_webhook_events', {
      p_event_id: alvo.eventRowId ?? null,
      p_limit: 1,
      p_lease_seconds: 120,
    });
    if (error) {
      console.error('[bling] não consegui pegar webhooks:', error.message);
      break;
    }
    const pega = lerPega(((data ?? []) as unknown[])[0]);
    if (!pega) break;

    const { data: linha } = await db
      .from('bling_webhook_events')
      .select('id, account_id, connection_id, event, resource_id, summary')
      .eq('id', pega.id)
      .maybeSingle();
    if (!linha) continue;

    let status: 'processed' | 'ignored' | 'failed' | 'pending' = 'processed';
    let erro: string | null = null;
    try {
      status = await processarEvento(db, linha as EventoLinha, opcoes);
    } catch (e) {
      // Passageiro (rede, 5xx do Bling): volta a pendente e o cron tenta de
      // novo; a claim para em dez tentativas.
      const passageiro = e instanceof BlingApiError ? e.isTransient || e.isRateLimited : true;
      status = passageiro ? 'pending' : 'failed';
      erro = (e instanceof Error ? e.message : String(e)).slice(0, 600);
    }
    let termino = db
      .from('bling_webhook_events')
      .update({
        status,
        error: erro,
        locked_until: null,
        lock_token: null,
        processed_at: status === 'pending' ? null : new Date((opcoes.now ?? Date.now)()).toISOString(),
      })
      .eq('id', pega.id);
    if (pega.lockToken) termino = termino.eq('lock_token', pega.lockToken);
    await termino;
    feitos++;
  }
  return feitos;
}

async function processarEvento(
  db: SupabaseClient,
  evento: EventoLinha,
  opcoes: { deps?: ClientDeps; now?: () => number }
): Promise<'processed' | 'ignored'> {
  if (!evento.account_id || !evento.connection_id || !evento.resource_id) return 'ignored';

  if (evento.event.startsWith('product.')) {
    // O cadastro é relido na próxima importação: esquecer o resumo da
    // listagem obriga o detalhe. O orçamento já enviado não muda — tem
    // snapshot (085).
    await db
      .from('products')
      .update({ bling_list_hash: null })
      .eq('account_id', evento.account_id)
      .eq('bling_product_id', evento.resource_id);
    return 'processed';
  }

  if (!evento.event.startsWith('order.')) return 'ignored';

  const { data: ajustes } = await db.from('bling_settings').select('*').eq('account_id', evento.account_id).maybeSingle();
  const settings = ajustes as (Partial<BlingSettingsRow> & { orders_enabled?: boolean }) | null;
  if (!settings?.orders_enabled) return 'ignored';

  // Pedido que não nasceu no CRM: nem relê (economiza a cota).
  const loja = evento.summary?.numeroLoja;
  const { data: ligado } = await db
    .from('deals')
    .select('id')
    .eq('account_id', evento.account_id)
    .eq('bling_order_id', evento.resource_id)
    .maybeSingle();
  if (!ligado && !(typeof loja === 'string' && loja.startsWith('CRM-ORC-'))) return 'ignored';

  if (evento.event === 'order.deleted') {
    await applyRemoteOrder(db, {
      accountId: evento.account_id,
      settings,
      remote: { id: evento.resource_id, numero: null, numeroLoja: typeof loja === 'string' ? loja : null, situacaoId: null, total: null, deleted: true },
      source: 'bling',
      now: opcoes.now,
    });
    return 'processed';
  }

  // Fora de ordem: relê o pedido por id e aplica o que ELE diz agora.
  let remoto: Record<string, unknown> | null = null;
  try {
    const lido = await blingRequest<{ data?: Record<string, unknown> }>(
      db,
      evento.connection_id,
      `/pedidos/vendas/${encodeURIComponent(evento.resource_id)}`,
      {},
      opcoes.deps ?? {}
    );
    remoto = lido?.data ?? null;
  } catch (e) {
    if (e instanceof BlingApiError && e.status === 404) {
      await applyRemoteOrder(db, {
        accountId: evento.account_id,
        settings,
        remote: { id: evento.resource_id, numero: null, numeroLoja: null, situacaoId: null, total: null, deleted: true },
        source: 'bling',
        now: opcoes.now,
      });
      return 'processed';
    }
    throw e;
  }
  const resumo = summarizeRemoteOrder(remoto);
  if (!resumo) return 'ignored';
  await applyRemoteOrder(db, { accountId: evento.account_id, settings, remote: resumo, source: 'bling', now: opcoes.now });
  return 'processed';
}
