import type { SupabaseClient } from '@supabase/supabase-js';

import type { ClientDeps } from './client';
import {
  loadOrderForBling,
  orderSourceHash,
  syncOrder,
  type LoadedOrder,
  type OrderOutcome,
} from './orders';

/**
 * A FILA DE ESCRITAS NO BLING (086) — enfileirar, pegar com lease, terminar.
 *
 * Sem worker: a rota enfileira e processa com `after()`; o cron de minuto
 * drena o que sobrou e retenta. As duas portas chamam `runOperations`, e o
 * lease (`bling_claim_operations`) garante que as duas não pegam a mesma.
 *
 * O término é um compare-and-set pelo `lock_token`: um processo que perdeu o
 * lease (demorou mais que ele) não sobrescreve o que o outro gravou.
 */

export type OrderKind = 'create_order' | 'update_order';

export interface EnqueueResult {
  operationId: string;
  status: string;
  created: boolean;
  kind: OrderKind;
}

/** Espera antes da próxima tentativa, pela quantidade de tentativas feitas. */
export function retryDelaySeconds(tentativas: number): number {
  const escada = [30, 120, 600, 1800, 3600];
  return escada[Math.min(Math.max(tentativas, 1), escada.length) - 1];
}

/**
 * Enfileira criar ou atualizar o pedido desta oportunidade.
 *
 * Criar tem UMA chave por oportunidade; atualizar leva o resumo do pedido
 * gravado — o mesmo pedido pedido duas vezes é uma operação só.
 */
export async function enqueueOrderSync(
  db: SupabaseClient,
  args: { accountId: string; dealId: string; userId: string | null; loaded?: LoadedOrder }
): Promise<EnqueueResult | { error: 'not_found' | 'enqueue_failed'; detail?: string }> {
  const pedido = args.loaded ?? (await loadOrderForBling(db, args.accountId, args.dealId));
  if (!pedido) return { error: 'not_found' };

  const kind: OrderKind = pedido.deal.bling_order_id ? 'update_order' : 'create_order';
  const hash = orderSourceHash(pedido);
  const chave = kind === 'create_order' ? `create_order:${args.dealId}` : `update_order:${args.dealId}:${hash.slice(0, 32)}`;

  const { data, error } = await db.rpc('bling_enqueue_operation', {
    p_account_id: args.accountId,
    p_deal_id: args.dealId,
    p_kind: kind,
    p_key: chave,
    p_payload_hash: hash,
    p_params: {},
    p_requested_by: args.userId,
  });
  if (error) {
    if (error.code === 'P0002') return { error: 'not_found' };
    return { error: 'enqueue_failed', detail: error.message };
  }
  const linha = (Array.isArray(data) ? data[0] : data) as
    | { operation_id: string; operation_status: string; created: boolean }
    | undefined;
  if (!linha) return { error: 'enqueue_failed', detail: 'sem linha' };
  return { operationId: linha.operation_id, status: linha.operation_status, created: linha.created, kind };
}

interface Operacao {
  id: string;
  account_id: string;
  deal_id: string | null;
  kind: string;
  attempts: number;
  max_attempts: number;
}

export interface RunDeps {
  client?: ClientDeps;
  now?: () => number;
  /** A data do pedido quando a venda não tem data: hoje no fuso da conta. */
  today?: (accountId: string) => Promise<string>;
}

/** Hoje no fuso da conta — `accounts.timezone`, e São Paulo na falta. */
export async function accountToday(db: SupabaseClient, accountId: string, now = Date.now()): Promise<string> {
  const { data } = await db.from('accounts').select('timezone').eq('id', accountId).maybeSingle();
  const fuso = (data as { timezone?: string } | null)?.timezone || 'America/Sao_Paulo';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

async function processar(db: SupabaseClient, op: Operacao, deps: RunDeps): Promise<OrderOutcome> {
  if (!op.deal_id) return { status: 'failed', error: 'deal_missing' };
  if (op.kind !== 'create_order' && op.kind !== 'update_order') {
    // As mudanças de situação e os lançamentos chegam na Fase 5.
    return { status: 'failed', error: `unsupported:${op.kind}` };
  }
  const pedido = await loadOrderForBling(db, op.account_id, op.deal_id);
  if (!pedido) return { status: 'failed', error: 'deal_missing' };
  const today = deps.today ? await deps.today(op.account_id) : await accountToday(db, op.account_id, (deps.now ?? Date.now)());
  return syncOrder(db, pedido, op.kind, { today, deps: deps.client, now: deps.now });
}

async function terminar(
  db: SupabaseClient,
  op: Operacao,
  lockToken: string,
  desfecho: OrderOutcome,
  agoraMs: number
): Promise<void> {
  const agora = new Date(agoraMs).toISOString();

  if (desfecho.status === 'retry' && op.attempts < op.max_attempts) {
    const { data } = await db
      .from('bling_operations')
      .update({
        status: desfecho.uncertain ? 'uncertain' : 'queued',
        error: desfecho.error.slice(0, 600),
        next_attempt_at: new Date(agoraMs + retryDelaySeconds(op.attempts) * 1000).toISOString(),
        lock_token: null,
        locked_until: null,
        updated_at: agora,
      })
      .eq('id', op.id)
      .eq('lock_token', lockToken)
      .select('id');
    // Perdeu o lease: outro processo é dono agora, e a oportunidade é dele.
    if (!data?.length || !op.deal_id) return;
    await db.from('deals').update({ sync_error: desfecho.error.slice(0, 600) }).eq('id', op.deal_id);
    return;
  }

  const sucesso = desfecho.status === 'succeeded';
  const erro = sucesso ? null : desfecho.error.slice(0, 600);
  const { data } = await db
    .from('bling_operations')
    .update({
      status: sucesso ? 'succeeded' : 'failed',
      error: erro,
      result: sucesso ? desfecho.result : null,
      finished_at: agora,
      lock_token: null,
      locked_until: null,
      updated_at: agora,
    })
    .eq('id', op.id)
    .eq('lock_token', lockToken)
    .select('id');
  if (!data?.length || !op.deal_id) return;

  if (desfecho.status === 'succeeded') {
    if (Object.keys(desfecho.dealPatch).length > 0) {
      await db.from('deals').update(desfecho.dealPatch).eq('id', op.deal_id);
    } else {
      await db.from('deals').update({ sync_status: 'synced', sync_error: null }).eq('id', op.deal_id);
    }
    return;
  }
  const patch =
    desfecho.status === 'failed' && desfecho.dealPatch
      ? desfecho.dealPatch
      : { sync_status: 'error', sync_error: erro };
  await db.from('deals').update(patch).eq('id', op.deal_id);
}

/**
 * Pega e processa: uma operação específica (o `after()` da rota) ou as
 * vencidas (o cron). Devolve quantas processou.
 */
export async function runOperations(
  db: SupabaseClient,
  alvo: { accountId?: string | null; operationId?: string | null; limit?: number },
  deps: RunDeps = {}
): Promise<number> {
  const agora = deps.now ?? Date.now;
  const { data, error } = await db.rpc('bling_claim_operations', {
    p_account_id: alvo.accountId ?? null,
    p_operation_id: alvo.operationId ?? null,
    p_limit: alvo.limit ?? 5,
    p_lease_seconds: 180,
  });
  if (error) {
    console.error('[bling] não consegui pegar operações:', error.message);
    return 0;
  }

  const pegas = (data ?? []) as Array<{ id: string; lock_token: string; attempts: number }>;
  let feitas = 0;
  for (const pega of pegas) {
    const { data: linha } = await db
      .from('bling_operations')
      .select('id, account_id, deal_id, kind, attempts, max_attempts')
      .eq('id', pega.id)
      .maybeSingle();
    if (!linha) continue;
    const op = linha as Operacao;

    let desfecho: OrderOutcome;
    try {
      desfecho = await processar(db, op, deps);
    } catch (erro) {
      console.error('[bling] operação estourou:', erro instanceof Error ? erro.message : erro);
      desfecho = { status: 'retry', error: 'unexpected', uncertain: op.kind === 'create_order' };
    }
    try {
      await terminar(db, op, pega.lock_token, desfecho, agora());
    } catch (erro) {
      // O lease vence e o cron pega de novo — perder o registro de UMA não
      // pode derrubar as outras pegas desta rodada.
      console.error('[bling] não consegui terminar a operação:', erro instanceof Error ? erro.message : erro);
    }
    feitas++;
  }
  return feitas;
}
