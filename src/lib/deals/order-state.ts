import { orderLock, type OrderLock } from './order-lock';

/**
 * O PEDIDO COMO A GAVETA DEVE ENXERGÁ-LO — a prop `deal` (do quadro) com o
 * que a fila deixou por cima (`GET /api/bling/orders/[dealId]`).
 *
 * Puro, para ser testado sem a gaveta: a auditoria da 0.11.0 achou três
 * defeitos que eram a gaveta lendo a prop depois de a situação mudar —
 * trava velha (o próximo "Salvar" mandava itens a um pedido travado), etapa
 * velha (o "Salvar" devolvia a etapa que o pedido tinha acabado de mudar) e
 * desfecho velho.
 */

export interface RemoteOrderState {
  orderStatus: string | null;
  syncStatus: string | null;
  syncError: string | null;
  blingOrderNumber: string | null;
  blingOrderId: string | null;
  blingExternalKey: string | null;
  accountsLaunchedAt: string | null;
  stageId: string | null;
  status: string | null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** A linha `deal` da rota, no formato da gaveta. */
export function remoteOrderState(linha: Record<string, unknown> | null | undefined): RemoteOrderState | null {
  if (!linha || typeof linha !== 'object') return null;
  return {
    orderStatus: texto(linha.order_status),
    syncStatus: texto(linha.sync_status),
    syncError: texto(linha.sync_error),
    blingOrderNumber: texto(linha.bling_order_number),
    blingOrderId: texto(linha.bling_order_id),
    blingExternalKey: texto(linha.bling_external_key),
    accountsLaunchedAt: texto(linha.accounts_launched_at),
    stageId: texto(linha.stage_id),
    status: texto(linha.status),
  };
}

export interface CurrentOrder extends Omit<RemoteOrderState, 'stageId' | 'status'> {
  lock: OrderLock;
  /** Em aberto (ou ainda sem pedido): o único estado em que o Bling aceita atualizar. */
  open: boolean;
  /** Registrar/atualizar faz sentido agora: trava aberta E Em aberto. */
  syncable: boolean;
  /**
   * Já é pedido no Bling (ou pode ser: a chave é gravada logo antes do POST).
   * O estado de sincronização sozinho não conta: uma sincronização que falhou
   * antes de enviar não deixa pedido nenhum lá (091).
   */
  isOrder: boolean;
}

type DealLike = {
  order_status?: string | null;
  sync_status?: string | null;
  sync_error?: string | null;
  bling_order_number?: string | null;
  bling_order_id?: string | null;
  bling_external_key?: string | null;
  accounts_launched_at?: string | null;
};

export function currentOrder(deal: DealLike | null | undefined, remoto: RemoteOrderState | null): CurrentOrder {
  const base = remoto ?? {
    orderStatus: deal?.order_status ?? null,
    syncStatus: deal?.sync_status ?? null,
    syncError: deal?.sync_error ?? null,
    blingOrderNumber: deal?.bling_order_number ?? null,
    blingOrderId: deal?.bling_order_id ?? null,
    blingExternalKey: deal?.bling_external_key ?? null,
    accountsLaunchedAt: deal?.accounts_launched_at ?? null,
  };
  const lock = orderLock(base.orderStatus, base.accountsLaunchedAt);
  const open = !base.orderStatus || base.orderStatus === 'em_aberto';
  return {
    orderStatus: base.orderStatus,
    syncStatus: base.syncStatus,
    syncError: base.syncError,
    blingOrderNumber: base.blingOrderNumber,
    blingOrderId: base.blingOrderId,
    blingExternalKey: base.blingExternalKey,
    accountsLaunchedAt: base.accountsLaunchedAt,
    lock,
    open,
    syncable: lock === 'open' && open,
    isOrder: !!base.blingOrderId || !!base.orderStatus || !!base.blingExternalKey,
  };
}

/** O que a tela faz com uma resposta do acompanhamento. */
export type WatchStep =
  | { kind: 'wait' }
  | { kind: 'done'; ok: true; outcome: 'synced' | 'changed' }
  | { kind: 'done'; ok: false; outcome: 'divergent' | 'failed'; error: string | null };

interface EstadoDaRota {
  deal?: Record<string, unknown> | null;
  operation?: { id?: unknown; kind?: unknown; status?: unknown; error?: unknown } | null;
}

/**
 * Uma volta do acompanhamento de UMA operação — a que a tela pediu.
 *
 * Pelo estado da oportunidade, uma operação mais velha terminando parecia o
 * desfecho desta: o orçamento saía antes de o PUT desta rodar, ou um envio
 * que ia dar certo era cancelado pela falha da outra.
 */
export function watchOperation(operationId: string, estado: EstadoDaRota | null | undefined): WatchStep {
  const op = estado?.operation;
  if (!estado?.deal || !op || op.id !== operationId) return { kind: 'wait' };
  if (op.status === 'failed') {
    return { kind: 'done', ok: false, outcome: 'failed', error: typeof op.error === 'string' ? op.error : null };
  }
  if (op.status !== 'succeeded') return { kind: 'wait' };
  if (op.kind === 'change_status') return { kind: 'done', ok: true, outcome: 'changed' };
  // A criação/atualização passou, mas o Bling devolveu outro pedido.
  if (estado.deal.sync_status === 'divergent') {
    return { kind: 'done', ok: false, outcome: 'divergent', error: texto(estado.deal.sync_error) };
  }
  return { kind: 'done', ok: true, outcome: 'synced' };
}
