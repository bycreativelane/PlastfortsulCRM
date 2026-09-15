import type { OrderStatus } from '@/lib/deals/order-lock';

import { foldName, STATUS_COLUMN, type BlingSettingsRow, type Reference, type StatusRole } from './health';

/**
 * A MÁQUINA DE ESTADOS DO PEDIDO (§6 do plano, D1 = B) — pura.
 *
 *   Em aberto ──► Em andamento ──► Atendido
 *       │  ▲            │
 *       ▼  │            ▼
 *   Compra futura    Cancelado ◄── Em aberto
 *
 * Atendido e Cancelado são finais. O que cada passagem faz no financeiro e no
 * estoque vem de dois lugares, nesta ordem:
 *
 *   1. o que a especificação exige (`planStatusChange`): Em andamento lança
 *      contas; Atendido lança estoque; Cancelado estorna o que houver;
 *   2. o que a transição configurada NO BLING já faz sozinha
 *      (`transitionActions`, lida das ações da transição — 083). O que ela
 *      não fizer, o CRM chama explicitamente, uma vez, protegido pelos
 *      carimbos `*_launched_at`.
 */

export const ROLE_OF_STATUS: Record<OrderStatus, StatusRole> = {
  em_aberto: 'open',
  em_andamento: 'in_progress',
  atendido: 'fulfilled',
  cancelado: 'canceled',
  compra_futura: 'future_purchase',
};

export const STATUS_OF_ROLE: Record<StatusRole, OrderStatus> = {
  open: 'em_aberto',
  in_progress: 'em_andamento',
  fulfilled: 'atendido',
  canceled: 'cancelado',
  future_purchase: 'compra_futura',
};

/** As passagens que o CRM pede. Atendido não volta; Cancelado é final. */
export const NEXT_STATUSES: Record<OrderStatus, readonly OrderStatus[]> = {
  em_aberto: ['em_andamento', 'compra_futura', 'cancelado'],
  em_andamento: ['atendido', 'cancelado'],
  compra_futura: ['em_aberto'],
  atendido: [],
  cancelado: [],
};

export function canChangeStatus(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT_STATUSES[from].includes(to);
}

/**
 * A passagem que lança contas a partir do pedido COMO ESTÁ NO BLING — e por
 * isso só com o pedido do CRM sincronizado (auditoria da 0.11.0): uma parcela
 * trocada e nunca enviada viraria conta a receber errada, e depois de Em
 * andamento o CRM não atualiza mais o pedido.
 *
 * Atendido não entra: vem de Em andamento, quando os itens e as parcelas já
 * estão travados, e as datas da produção que continuam livres não mudam o
 * financeiro.
 */
export function statusNeedsSyncedOrder(to: OrderStatus): boolean {
  return to === 'em_andamento';
}

/** O id da situação no Bling para um status do CRM, pelos papéis confirmados. */
export function blingStatusId(
  settings: Partial<BlingSettingsRow> | null | undefined,
  status: OrderStatus
): string | null {
  const coluna = STATUS_COLUMN[ROLE_OF_STATUS[status]];
  const valor = settings?.[coluna];
  return typeof valor === 'string' && valor ? valor : null;
}

/** O status do CRM para um id de situação do Bling. */
export function statusFromBlingId(
  settings: Partial<BlingSettingsRow> | null | undefined,
  id: string | number | null | undefined
): OrderStatus | null {
  if (id === null || id === undefined) return null;
  for (const [status] of Object.entries(ROLE_OF_STATUS) as Array<[OrderStatus, StatusRole]>) {
    if (blingStatusId(settings, status) === String(id)) return status;
  }
  return null;
}

export type ActionKind = 'launch_accounts' | 'reverse_accounts' | 'launch_stock' | 'reverse_stock';

/**
 * Lê o nome de uma ação de transição do Bling ("Lançar contas", "Estornar
 * estoque"). Pelo nome porque é assim que o Bling as expõe; o que não se
 * reconhece fica de fora — e aí o CRM chama a ação explicitamente, que é o
 * lado seguro (a chamada é idempotente pelos carimbos).
 */
export function classifyAction(rotulo: string): ActionKind | null {
  const t = foldName(rotulo);
  const contas = /\bcontas?\b/.test(t);
  const estoque = /\bestoques?\b/.test(t);
  const lancar = /\blanc/.test(t);
  const estornar = /\bestorn/.test(t);
  if (contas && lancar) return 'launch_accounts';
  if (contas && estornar) return 'reverse_accounts';
  if (estoque && lancar) return 'launch_stock';
  if (estoque && estornar) return 'reverse_stock';
  return null;
}

/** As ações que a transição configurada no Bling executa sozinha. */
export function transitionActions(
  referencias: ReadonlyArray<Reference>,
  settings: Partial<BlingSettingsRow> | null | undefined,
  from: OrderStatus,
  to: OrderStatus
): { found: boolean; actions: Set<ActionKind> } {
  const de = blingStatusId(settings, from);
  const para = blingStatusId(settings, to);
  const acoes = new Set<ActionKind>();
  if (!de || !para) return { found: false, actions: acoes };

  const transicao = referencias.find(
    (r) =>
      r.kind === 'order_transition' &&
      r.removed_at === null &&
      r.active &&
      String((r.payload as { from_id?: unknown }).from_id) === de &&
      String((r.payload as { to_id?: unknown }).to_id) === para
  );
  if (!transicao) return { found: false, actions: acoes };

  const ids = ((transicao.payload as { action_ids?: unknown }).action_ids ?? []) as unknown[];
  for (const id of ids) {
    const acao = referencias.find((r) => r.kind === 'order_action' && r.bling_id === String(id));
    const tipo = acao ? classifyAction(acao.label) : null;
    if (tipo) acoes.add(tipo);
  }
  return { found: true, actions: acoes };
}

export interface StatusPlan {
  accounts: 'launch' | 'reverse' | null;
  stock: 'launch' | 'reverse' | null;
}

/**
 * O que a passagem EXIGE no financeiro e no estoque, dados os carimbos.
 *
 * Os carimbos são o que torna tudo repetível: um job que roda três vezes
 * lança contas uma vez, porque na segunda `accounts_launched_at` existe.
 */
export function planStatusChange(args: {
  to: OrderStatus;
  accountsLaunched: boolean;
  stockLaunched: boolean;
}): StatusPlan {
  switch (args.to) {
    case 'em_andamento':
      return { accounts: args.accountsLaunched ? null : 'launch', stock: null };
    case 'atendido':
      return {
        accounts: args.accountsLaunched ? null : 'launch',
        stock: args.stockLaunched ? null : 'launch',
      };
    case 'cancelado':
      return {
        accounts: args.accountsLaunched ? 'reverse' : null,
        stock: args.stockLaunched ? 'reverse' : null,
      };
    default:
      return { accounts: null, stock: null };
  }
}

// ------------------------------------------------------------------
// A etapa acompanha (D1 = B)
// ------------------------------------------------------------------

/** O nome da etapa do fluxo oficial para cada situação (§6 do plano). */
const ETAPA_DA_SITUACAO: Record<OrderStatus, readonly string[]> = {
  em_aberto: ['em aberto'],
  em_andamento: ['em andamento'],
  atendido: ['atendido'],
  compra_futura: ['compra futura'],
  cancelado: ['venda perdida'],
};

/**
 * A etapa do MESMO funil da oportunidade para a situação. "Em Andamento"
 * existe nos dois funis da PlastfortSul, e mover para a do outro seria
 * trocar a oportunidade de funil sem ninguém pedir. Sem etapa com o nome,
 * `null`: a etapa fica onde está, e isso é melhor do que inventar destino.
 */
export function stageForStatus<T extends { id: string; name: string; pipeline_id: string }>(
  etapas: ReadonlyArray<T>,
  pipelineId: string,
  status: OrderStatus
): T | null {
  const nomes = ETAPA_DA_SITUACAO[status];
  return etapas.find((e) => e.pipeline_id === pipelineId && nomes.includes(foldName(e.name))) ?? null;
}

/** O motivo de perda do pedido cancelado (D3). */
export const ORDER_CANCELED_REASON = 'orderCanceled';

/**
 * A linha de `deals` depois da mudança: situação, etapa que acompanha, e o
 * ganho/perdido do funil — Em andamento e Atendido são venda; Cancelado é
 * Venda Perdida com "Pedido cancelado" (D3).
 */
export function dealPatchForStatus(status: OrderStatus, etapaId: string | null): Record<string, unknown> {
  const patch: Record<string, unknown> = { order_status: status };
  if (etapaId) patch.stage_id = etapaId;
  if (status === 'em_andamento' || status === 'atendido') patch.status = 'won';
  if (status === 'cancelado') {
    patch.status = 'lost';
    patch.lost_reason = ORDER_CANCELED_REASON;
  }
  if (status === 'em_aberto' || status === 'compra_futura') patch.status = 'open';
  return patch;
}

/**
 * A etapa para onde um arrasto no quadro pode levar uma oportunidade que é
 * pedido. Antes de lançamento, qualquer etapa (o Bling não muda). Depois,
 * só a etapa da própria situação — sair dela seria o quadro dizendo uma coisa
 * e o financeiro outra.
 */
export function dragAllowed(args: {
  orderStatus: string | null | undefined;
  accountsLaunchedAt: string | null | undefined;
  targetStageName: string;
}): boolean {
  if (!args.accountsLaunchedAt) return true;
  const status = args.orderStatus as OrderStatus | null | undefined;
  if (!status || !(status in ETAPA_DA_SITUACAO)) return false;
  return ETAPA_DA_SITUACAO[status].includes(foldName(args.targetStageName));
}
