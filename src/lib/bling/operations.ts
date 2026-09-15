import type { SupabaseClient } from '@supabase/supabase-js';

import type { ClientDeps } from './client';
import { BlingLeaseLostError } from './errors';
import {
  loadOrderForBling,
  orderIsSynced,
  orderSourceHash,
  syncOrder,
  type LoadedOrder,
  type OrderEvent,
  type OrderOutcome,
} from './orders';
import { loadReferences } from './settings';
import { changeOrderStatus } from './status-change';
import { canChangeStatus, statusNeedsSyncedOrder } from './transitions';
import { isOrderStatus, type OrderStatus } from '@/lib/deals/order-lock';

/**
 * A FILA DE ESCRITAS NO BLING (086, 090) — enfileirar, pegar com lease,
 * terminar.
 *
 * Sem worker: a rota enfileira e processa com `after()`; o cron de minuto
 * drena o que sobrou e retenta. As duas portas chamam `runOperations`, e o
 * lease (`bling_claim_operations`) garante que as duas não pegam a mesma.
 *
 * Três regras que a auditoria da 0.11.0 trouxe (090):
 *
 * - UMA operação por vez. Pegar dez com um lease só fazia a sétima começar
 *   depois de o lease vencer, e o tique seguinte pegava a mesma.
 * - Lease renovado ANTES de cada escrita no Bling (`beforeWrite` do cliente,
 *   `bling_touch_operation`). Quem perdeu a vez para sem escrever.
 * - O término é UMA transação (`bling_finish_operation`): a operação, a
 *   oportunidade e o histórico, com compare-and-set pelo `lock_token`. Um
 *   processo que perdeu o lease não sobrescreve o que o outro gravou, e um
 *   reinício no meio não deixa a operação concluída sem o vínculo.
 */

export type OrderKind = 'create_order' | 'update_order' | 'change_status';

export interface EnqueueResult {
  operationId: string;
  status: string;
  created: boolean;
  kind: OrderKind;
}

/** O lease de cada operação, renovado antes de cada escrita. */
export const OPERATION_LEASE_SECONDS = 180;

/** Espera antes da próxima tentativa, pela quantidade de tentativas feitas. */
export function retryDelaySeconds(tentativas: number): number {
  const escada = [30, 120, 600, 1800, 3600];
  return escada[Math.min(Math.max(tentativas, 1), escada.length) - 1];
}

/**
 * Enfileira criar ou atualizar o pedido desta oportunidade.
 *
 * Criar tem UMA chave por oportunidade. Atualizar leva a versão da
 * sincronização e o resumo do pedido gravado: dois cliques no mesmo pedido
 * enquanto a fila não terminou são uma operação só; depois que ela termina
 * (a versão sobe), pedir de novo é outra — mesmo com o mesmo conteúdo. Sem a
 * versão, voltar o frete de 150 para 100 e de novo para 150 caía na
 * operação antiga "150", já concluída, e o Bling ficava com 100.
 */
export function orderSyncKey(kind: 'create_order' | 'update_order', pedido: LoadedOrder): string {
  if (kind === 'create_order') return `create_order:${pedido.deal.id}`;
  return `update_order:${pedido.deal.id}:${pedido.deal.sync_version ?? 0}:${orderSourceHash(pedido).slice(0, 32)}`;
}

export async function enqueueOrderSync(
  db: SupabaseClient,
  args: { accountId: string; dealId: string; userId: string | null; loaded?: LoadedOrder }
): Promise<EnqueueResult | { error: 'not_found' | 'enqueue_failed'; detail?: string }> {
  const pedido = args.loaded ?? (await loadOrderForBling(db, args.accountId, args.dealId));
  if (!pedido) return { error: 'not_found' };

  const kind: OrderKind = pedido.deal.bling_order_id ? 'update_order' : 'create_order';
  const hash = orderSourceHash(pedido);

  const { data, error } = await db.rpc('bling_enqueue_operation', {
    p_account_id: args.accountId,
    p_deal_id: args.dealId,
    p_kind: kind,
    p_key: orderSyncKey(kind, pedido),
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

/**
 * Enfileira mudar a situação do pedido (Fase 5).
 *
 * A chave leva a versão da sincronização: dois cliques no mesmo "Em
 * andamento" caem na mesma operação; voltar de Compra futura para Em aberto e
 * ir de novo para Compra futura, depois, é outra — a versão mudou no meio.
 *
 * Em andamento exige o pedido sincronizado: o Bling lança as contas do
 * pedido que ELE tem (`statusNeedsSyncedOrder`).
 */
export async function enqueueStatusChange(
  db: SupabaseClient,
  args: { accountId: string; dealId: string; userId: string | null; to: string }
): Promise<
  | EnqueueResult
  | { error: 'not_found' | 'not_created' | 'invalid_transition' | 'order_not_synced' | 'enqueue_failed'; detail?: string }
> {
  if (!isOrderStatus(args.to)) return { error: 'invalid_transition' };
  const pedido = await loadOrderForBling(db, args.accountId, args.dealId);
  if (!pedido) return { error: 'not_found' };
  const d = pedido.deal;
  if (!d.bling_order_id) return { error: 'not_created' };
  const origem = (d.order_status ?? 'em_aberto') as OrderStatus;
  if (!canChangeStatus(origem, args.to)) return { error: 'invalid_transition' };
  if (statusNeedsSyncedOrder(args.to) && !orderIsSynced(pedido) && !(await repeatsStatusChange(db, args, d.accounts_launched_at))) {
    return { error: 'order_not_synced' };
  }

  const { data, error } = await db.rpc('bling_enqueue_operation', {
    p_account_id: args.accountId,
    p_deal_id: args.dealId,
    p_kind: 'change_status',
    p_key: `change_status:${args.dealId}:${args.to}:${d.sync_version ?? 0}`,
    p_payload_hash: null,
    p_params: { from: origem, to: args.to },
    p_requested_by: args.userId,
  });
  if (error) return { error: 'enqueue_failed', detail: error.message };
  const linha = (Array.isArray(data) ? data[0] : data) as
    | { operation_id: string; operation_status: string; created: boolean }
    | undefined;
  if (!linha) return { error: 'enqueue_failed', detail: 'sem linha' };

  if (linha.created) {
    await db.from('deal_order_events').insert({
      account_id: args.accountId,
      deal_id: args.dealId,
      kind: 'status_requested',
      from_status: origem,
      to_status: args.to,
      source: 'crm',
      operation_id: linha.operation_id,
      actor_id: args.userId,
    });
  }
  return {
    operationId: linha.operation_id,
    status: linha.operation_status,
    created: linha.created,
    kind: 'change_status',
  };
}

/**
 * O pedido de Em andamento é a REPETIÇÃO de uma mudança que ficou pela metade?
 *
 * As contas já lançadas, ou uma mudança para a mesma situação na fila ou que
 * falhou: a exigência de "sincronizado" é da primeira vez. Sem esta saída, a
 * mudança que passou do PATCH e caiu nas tentativas seguintes deixava o CRM
 * Em aberto (com o carimbo), o Bling Em andamento, e nenhum caminho de volta:
 * pedir de novo dava `order_not_synced`, atualizar dava `order_locked`, e
 * cancelar dava "o Bling está em outra situação" (revisão da 090). A operação
 * confere de novo antes do PATCH — a repetição que ainda não passou dele
 * continua exigindo o pedido igual ao do Bling.
 */
async function repeatsStatusChange(
  db: SupabaseClient,
  args: { accountId: string; dealId: string; to: string },
  contasLancadas: string | null | undefined
): Promise<boolean> {
  if (contasLancadas) return true;
  const { data } = await db
    .from('bling_operations')
    .select('kind, status, params')
    .eq('account_id', args.accountId)
    .eq('deal_id', args.dealId)
    .eq('kind', 'change_status')
    .in('status', ['queued', 'running', 'uncertain', 'failed']);
  return ((data ?? []) as Array<{ params: Record<string, unknown> | null }>).some((o) => o.params?.to === args.to);
}

interface Operacao {
  id: string;
  account_id: string;
  deal_id: string | null;
  kind: string;
  attempts: number;
  max_attempts: number;
  params?: Record<string, unknown> | null;
  requested_by?: string | null;
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
  if (op.kind !== 'create_order' && op.kind !== 'update_order' && op.kind !== 'change_status') {
    // Lançar e estornar isolados não são pedidos pela tela: acontecem dentro
    // da mudança de situação.
    return { status: 'failed', error: `unsupported:${op.kind}` };
  }
  const pedido = await loadOrderForBling(db, op.account_id, op.deal_id);
  if (!pedido) return { status: 'failed', error: 'deal_missing' };

  if (op.kind === 'change_status') {
    const [referencias, etapas] = await Promise.all([
      pedido.connection ? loadReferences(db, pedido.connection.id) : Promise.resolve([]),
      pedido.deal.pipeline_id
        ? db
            .from('pipeline_stages')
            .select('id, name, pipeline_id')
            .eq('pipeline_id', pedido.deal.pipeline_id)
            .then(({ data }) => (data ?? []) as Array<{ id: string; name: string; pipeline_id: string }>)
        : Promise.resolve([]),
    ]);
    return changeOrderStatus(db, pedido, String(op.params?.to ?? ''), {
      references: referencias,
      stages: etapas,
      operationId: op.id,
      actorId: op.requested_by ?? null,
      deps: deps.client,
      now: deps.now,
    });
  }
  const today = deps.today ? await deps.today(op.account_id) : await accountToday(db, op.account_id, (deps.now ?? Date.now)());
  return syncOrder(db, pedido, op.kind, { today, deps: deps.client, now: deps.now });
}

/**
 * As colunas da oportunidade que `bling_finish_operation` (090) aceita no
 * patch — o espelho da lista do SQL (`operations.test.ts` compara as duas).
 */
export const FINISH_PATCH_COLUMNS = [
  'order_status',
  'bling_order_id',
  'bling_external_key',
  'bling_order_number',
  'bling_source_hash',
  'sync_status',
  'sync_error',
  'sync_version',
  'last_synced_at',
  'accounts_launched_at',
  'stock_launched_at',
  'stage_id',
  'status',
  'lost_reason',
] as const;

export interface FinishPlan {
  status: 'succeeded' | 'failed' | 'queued' | 'uncertain';
  error: string | null;
  result: Record<string, unknown> | null;
  retrySeconds: number | null;
  dealPatch: Record<string, unknown>;
  events: OrderEvent[];
}

/** O desfecho de uma operação, no formato do término (pura). */
export function finishPlan(op: Pick<Operacao, 'attempts' | 'max_attempts'>, desfecho: OrderOutcome): FinishPlan {
  const eventos = desfecho.events ?? [];
  if (desfecho.status === 'succeeded') {
    return {
      status: 'succeeded',
      error: null,
      result: desfecho.result,
      retrySeconds: null,
      dealPatch: Object.keys(desfecho.dealPatch).length > 0 ? desfecho.dealPatch : { sync_status: 'synced', sync_error: null },
      events: eventos,
    };
  }
  const erro = desfecho.error.slice(0, 600);
  if (desfecho.status === 'retry' && op.attempts < op.max_attempts) {
    return {
      status: desfecho.uncertain ? 'uncertain' : 'queued',
      error: erro,
      result: null,
      retrySeconds: retryDelaySeconds(op.attempts),
      dealPatch: { sync_error: erro, ...(desfecho.dealPatch ?? {}) },
      events: eventos,
    };
  }
  // Falha de vez — ou a última tentativa de uma repetição. O que a falha
  // trouxe (divergente, carimbos do que deu certo, a situação que já mudou
  // lá) vence o "erro" genérico.
  const final = desfecho.status === 'retry' ? (desfecho.finalDealPatch ?? {}) : {};
  return {
    status: 'failed',
    error: erro,
    result: null,
    retrySeconds: null,
    dealPatch: { sync_status: 'error', sync_error: erro, ...(desfecho.dealPatch ?? {}), ...final },
    events: eventos,
  };
}

/**
 * O patch sem as colunas que o término não escreve. Uma coluna fora da lista
 * faria o término falhar para sempre (o banco recusa a chave), e a operação
 * rodaria de novo a cada lease.
 */
export function dropUnknownFinishColumns(patch: Record<string, unknown>): {
  patch: Record<string, unknown>;
  dropped: string[];
} {
  const permitidas = new Set<string>(FINISH_PATCH_COLUMNS);
  const dropped = Object.keys(patch).filter((c) => !permitidas.has(c));
  return { patch: Object.fromEntries(Object.entries(patch).filter(([c]) => permitidas.has(c))), dropped };
}

/**
 * Termina a operação numa transação. Devolve se este processo ainda era o
 * dono (o compare-and-set passou).
 */
async function terminar(db: SupabaseClient, op: Operacao, lockToken: string, desfecho: OrderOutcome): Promise<boolean> {
  const plano = finishPlan(op, desfecho);
  const limpo = dropUnknownFinishColumns(plano.dealPatch);
  if (limpo.dropped.length > 0) {
    console.error('[bling] o término não escreve estas colunas:', limpo.dropped.join(', '));
    plano.dealPatch = limpo.patch;
  }

  const chamar = (eventos: OrderEvent[]) =>
    db.rpc('bling_finish_operation', {
      p_operation_id: op.id,
      p_lock_token: lockToken,
      p_status: plano.status,
      p_error: plano.error,
      p_result: plano.result,
      p_retry_seconds: plano.retrySeconds,
      p_deal_patch: plano.dealPatch,
      p_events: eventos,
    });

  let { data, error } = await chamar(plano.events);
  if (error && plano.events.length > 0) {
    // O histórico é registro: sem ele, a operação e a oportunidade ainda
    // terminam — e um evento que o banco recusa não trava a fila.
    console.error('[bling] o término recusou o histórico; terminando sem ele:', error.message);
    ({ data, error } = await chamar([]));
  }
  if (error) throw new Error(`[bling] não consegui terminar a operação: ${error.message}`);
  return data === true;
}

/**
 * Pega e processa, UMA de cada vez: uma operação específica (o `after()` da
 * rota) ou as vencidas (o cron), até `limit`. Devolve quantas processou.
 */
export async function runOperations(
  db: SupabaseClient,
  alvo: { accountId?: string | null; operationId?: string | null; limit?: number },
  deps: RunDeps = {}
): Promise<number> {
  const limite = alvo.operationId ? 1 : Math.max(1, Math.min(alvo.limit ?? 5, 20));
  let feitas = 0;

  for (let volta = 0; volta < limite; volta++) {
    const { data, error } = await db.rpc('bling_claim_operations', {
      p_account_id: alvo.accountId ?? null,
      p_operation_id: alvo.operationId ?? null,
      p_limit: 1,
      p_lease_seconds: OPERATION_LEASE_SECONDS,
    });
    if (error) {
      console.error('[bling] não consegui pegar operações:', error.message);
      break;
    }
    const pega = ((data ?? []) as Array<{ id: string; lock_token: string; attempts: number }>)[0];
    if (!pega) break;

    const { data: linha } = await db
      .from('bling_operations')
      .select('id, account_id, deal_id, kind, attempts, max_attempts, params, requested_by')
      .eq('id', pega.id)
      .maybeSingle();
    if (!linha) continue;
    const op = linha as Operacao;

    // Antes de cada escrita no Bling: ainda sou o dono? Renova e segue; não
    // sou, para sem escrever.
    const renovar = async () => {
      const { data: vivo, error: erroRenovar } = await db.rpc('bling_touch_operation', {
        p_operation_id: pega.id,
        p_lock_token: pega.lock_token,
        p_lease_seconds: OPERATION_LEASE_SECONDS,
      });
      if (erroRenovar || vivo !== true) throw new BlingLeaseLostError(pega.id);
    };

    let desfecho: OrderOutcome;
    try {
      desfecho = await processar(db, op, { ...deps, client: { ...deps.client, beforeWrite: renovar } });
    } catch (erro) {
      if (erro instanceof BlingLeaseLostError) {
        desfecho = { status: 'retry', error: 'lease_lost', uncertain: false };
      } else {
        console.error('[bling] operação estourou:', erro instanceof Error ? erro.message : erro);
        desfecho = { status: 'retry', error: 'unexpected', uncertain: op.kind === 'create_order' };
      }
    }
    try {
      await terminar(db, op, pega.lock_token, desfecho);
    } catch (erro) {
      // O lease vence e o cron pega de novo — perder o registro de UMA não
      // pode derrubar as outras desta rodada.
      console.error('[bling] não consegui terminar a operação:', erro instanceof Error ? erro.message : erro);
    }
    feitas++;
  }
  return feitas;
}
