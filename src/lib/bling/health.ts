/**
 * A matriz de saúde da integração: o que o pedido vai precisar do Bling, e se
 * está lá, ativo e confirmado por um admin.
 *
 * Pura — recebe o cache (`bling_references`) e os papéis confirmados
 * (`bling_settings`) e devolve o relatório. A tela desenha; a Fase 3 usa o
 * mesmo relatório para dizer "pronto para o Bling".
 *
 * ------------------------------------------------------------------
 * SUGERIR PELO NOME, CONFIRMAR POR UM ADMIN
 * ------------------------------------------------------------------
 *
 * "Em andamento" tem id diferente em cada conta Bling, e "Compra futura" é
 * situação personalizada. A matriz sugere pelo nome (sem acento, sem caixa) e
 * só conta como pronto o que foi CONFIRMADO: a especificação proíbe resolver
 * pelo nome na hora de salvar, e uma sugestão errada confirmada em silêncio
 * mandaria pedido para a situação errada.
 *
 * ------------------------------------------------------------------
 * O QUE A MATRIZ NÃO SABE
 * ------------------------------------------------------------------
 *
 * Se mudar a situação pela API executa as ações configuradas na transição
 * (lançar contas, estoque) não é documentado. A matriz mostra as ações
 * configuradas; a resposta vem da homologação (Fase 5), nunca de suposição.
 */

export const STATUS_ROLES = [
  'open',
  'in_progress',
  'fulfilled',
  'canceled',
  'future_purchase',
] as const;
export type StatusRole = (typeof STATUS_ROLES)[number];

/** O nome de cada situação na operação da empresa (especificação, §1). */
const NOME_DA_SITUACAO: Record<StatusRole, string> = {
  open: 'em aberto',
  in_progress: 'em andamento',
  fulfilled: 'atendido',
  canceled: 'cancelado',
  future_purchase: 'compra futura',
};

/** A raiz das categorias de receita do pedido (especificação, §4.2). */
export const REVENUE_ROOT_NAME = 'venda direta';

/**
 * As passagens que o CRM vai pedir ao Bling (§6 do plano). Atendido é final:
 * não há Atendido → Cancelado.
 */
export const REQUIRED_TRANSITIONS: ReadonlyArray<readonly [StatusRole, StatusRole]> = [
  ['open', 'in_progress'],
  ['in_progress', 'fulfilled'],
  ['open', 'future_purchase'],
  ['future_purchase', 'open'],
  ['open', 'canceled'],
  ['in_progress', 'canceled'],
];

export interface Reference {
  kind: string;
  bling_id: string;
  parent_bling_id: string | null;
  label: string;
  active: boolean;
  removed_at: string | null;
  payload: Record<string, unknown>;
}

export interface BlingSettingsRow {
  company_id: string;
  order_module_id: string | null;
  status_open_id: string | null;
  status_in_progress_id: string | null;
  status_fulfilled_id: string | null;
  status_canceled_id: string | null;
  status_future_purchase_id: string | null;
  revenue_root_category_id: string | null;
  payment_method_ids: string[] | null;
}

export const STATUS_COLUMN: Record<StatusRole, keyof BlingSettingsRow> = {
  open: 'status_open_id',
  in_progress: 'status_in_progress_id',
  fulfilled: 'status_fulfilled_id',
  canceled: 'status_canceled_id',
  future_purchase: 'status_future_purchase_id',
};

/**
 * `ok`           confirmado, existe e está ativo
 * `unconfirmed`  ninguém confirmou; pode haver sugestão
 * `missing`      não há o que confirmar (ex.: "Compra futura" não existe)
 * `inactive`     confirmado, mas inativo no Bling
 * `removed`      confirmado, mas a última sincronização não trouxe mais
 * `incompatible` confirmado, mas não serve (ex.: forma que não recebe)
 */
export type CheckState = 'ok' | 'unconfirmed' | 'missing' | 'inactive' | 'removed' | 'incompatible';

export interface RefPick {
  id: string;
  label: string;
}

export interface RoleCheck {
  state: CheckState;
  confirmed: RefPick | null;
  suggestion: RefPick | null;
}

export interface TransitionCheck {
  from: StatusRole;
  to: StatusRole;
  /** `unmapped`: falta confirmar uma das duas situações. */
  state: 'ok' | 'missing' | 'inactive' | 'unmapped';
  actions: string[];
}

export interface PaymentCheck extends RefPick {
  state: 'ok' | 'inactive' | 'removed' | 'incompatible';
  /** 1 Conta a receber/pagar · 2 Ficha financeira · 3 Caixa e bancos */
  destination: number | null;
  /** 1 Pagamentos · 2 Recebimentos · 3 os dois */
  purpose: number | null;
}

export interface CategoryCheck extends RefPick {
  state: 'ok' | 'inactive' | 'removed';
  depth: number;
}

export interface HealthReport {
  /** Os papéis valem para outra empresa: a conta reconectou outra. */
  settingsFromOtherCompany: boolean;
  orderModule: RoleCheck;
  statuses: Record<StatusRole, RoleCheck>;
  transitions: TransitionCheck[];
  revenueRoot: RoleCheck;
  revenueCategories: CategoryCheck[];
  paymentMethods: PaymentCheck[];
  counts: { sellers: number; warehouses: number; logistics: number };
  customerContactType: boolean;
  /** Quantos itens obrigatórios ainda não estão `ok`. */
  pending: number;
  green: boolean;
}

export function foldName(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const vivo = (r: Reference) => r.removed_at === null;
const escolha = (r: Reference): RefPick => ({ id: r.bling_id, label: r.label });

function estadoDe(r: Reference | undefined): 'ok' | 'inactive' | 'removed' | null {
  if (!r) return null;
  if (!vivo(r)) return 'removed';
  return r.active ? 'ok' : 'inactive';
}

function papel(
  confirmadoId: string | null | undefined,
  candidatos: Reference[],
  todosDoTipo: Reference[],
  sugerir: () => Reference | undefined
): RoleCheck {
  if (confirmadoId) {
    const ref = todosDoTipo.find((r) => r.bling_id === confirmadoId);
    if (!ref) return { state: 'removed', confirmed: { id: confirmadoId, label: confirmadoId }, suggestion: null };
    return { state: estadoDe(ref) ?? 'removed', confirmed: escolha(ref), suggestion: null };
  }
  const sugestao = candidatos.length ? sugerir() : undefined;
  return {
    state: sugestao ? 'unconfirmed' : 'missing',
    confirmed: null,
    suggestion: sugestao ? escolha(sugestao) : null,
  };
}

export function buildHealth(
  referencias: Reference[],
  settingsRow: BlingSettingsRow | null,
  companyId: string
): HealthReport {
  const settingsFromOtherCompany = Boolean(settingsRow && settingsRow.company_id !== companyId);
  const settings = settingsFromOtherCompany ? null : settingsRow;
  const doTipo = (kind: string) => referencias.filter((r) => r.kind === kind);

  // Módulo
  const modulos = doTipo('order_module');
  const orderModule = papel(settings?.order_module_id, modulos.filter(vivo), modulos, () =>
    modulos.filter(vivo).find((m) => foldName(String(m.payload.descricao ?? '')) === 'pedidos de venda') ??
    modulos.filter(vivo).find((m) => foldName(String(m.payload.nome ?? '')) === 'vendas')
  );
  const moduloId = orderModule.confirmed?.id ?? orderModule.suggestion?.id ?? null;

  // Situações do módulo
  const situacoes = doTipo('order_status').filter((s) => !moduloId || s.parent_bling_id === moduloId);
  const statuses = Object.fromEntries(
    STATUS_ROLES.map((role) => [
      role,
      papel(settings?.[STATUS_COLUMN[role]] as string | null, situacoes.filter(vivo), situacoes, () =>
        situacoes.filter(vivo).find((s) => foldName(s.label) === NOME_DA_SITUACAO[role])
      ),
    ])
  ) as Record<StatusRole, RoleCheck>;

  // Transições entre as situações CONFIRMADAS
  const acoes = new Map(doTipo('order_action').map((a) => [a.bling_id, a.label]));
  const transicoes = doTipo('order_transition').filter(vivo);
  const transitions: TransitionCheck[] = REQUIRED_TRANSITIONS.map(([from, to]) => {
    const de = statuses[from].state === 'ok' ? statuses[from].confirmed?.id : null;
    const para = statuses[to].state === 'ok' ? statuses[to].confirmed?.id : null;
    if (!de || !para) return { from, to, state: 'unmapped', actions: [] };
    const t = transicoes.find((x) => x.payload.from_id === de && x.payload.to_id === para);
    if (!t) return { from, to, state: 'missing', actions: [] };
    const ids = Array.isArray(t.payload.action_ids) ? (t.payload.action_ids as string[]) : [];
    return {
      from,
      to,
      state: t.active ? 'ok' : 'inactive',
      actions: ids.map((id) => acoes.get(id) ?? id),
    };
  });

  // Categoria raiz e a árvore embaixo dela
  const categorias = doTipo('revenue_category');
  const receita = (r: Reference) => r.payload.tipo !== 1;
  const revenueRootBase = papel(
    settings?.revenue_root_category_id,
    categorias.filter((c) => vivo(c) && c.parent_bling_id === null && receita(c)),
    categorias,
    () =>
      categorias.find(
        (c) => vivo(c) && c.parent_bling_id === null && receita(c) && foldName(c.label) === REVENUE_ROOT_NAME
      )
  );
  const raizRef = revenueRootBase.confirmed
    ? categorias.find((c) => c.bling_id === revenueRootBase.confirmed?.id)
    : undefined;
  const revenueRoot: RoleCheck =
    revenueRootBase.state === 'ok' && raizRef && !receita(raizRef)
      ? { ...revenueRootBase, state: 'incompatible' }
      : revenueRootBase;

  const revenueCategories: CategoryCheck[] = [];
  if (revenueRoot.confirmed && (revenueRoot.state === 'ok' || revenueRoot.state === 'inactive')) {
    const filhos = (paiId: string, profundidade: number) => {
      // Profundidade limitada: um ciclo no cache não trava a tela.
      if (profundidade > 6) return;
      for (const c of categorias.filter((x) => x.parent_bling_id === paiId).sort((a, b) => a.label.localeCompare(b.label))) {
        revenueCategories.push({ ...escolha(c), state: estadoDe(c) ?? 'removed', depth: profundidade });
        filhos(c.bling_id, profundidade + 1);
      }
    };
    filhos(revenueRoot.confirmed.id, 1);
  }

  // Formas de pagamento liberadas no CRM
  const formas = doTipo('payment_method');
  const paymentMethods: PaymentCheck[] = (settings?.payment_method_ids ?? []).map((id) => {
    const f = formas.find((x) => x.bling_id === id);
    if (!f) return { id, label: id, state: 'removed', destination: null, purpose: null };
    const destino = typeof f.payload.destino === 'number' ? f.payload.destino : null;
    const finalidade = typeof f.payload.finalidade === 'number' ? f.payload.finalidade : null;
    // Contas a Receber exigem finalidade que recebe (2 ou 3) e destino
    // Conta a receber/pagar (1) — especificação, §4.6.
    const serve = destino === 1 && (finalidade === 2 || finalidade === 3);
    const estado = estadoDe(f) ?? 'removed';
    return {
      ...escolha(f),
      state: estado !== 'ok' ? estado : serve ? 'ok' : 'incompatible',
      destination: destino,
      purpose: finalidade,
    };
  });

  const counts = {
    sellers: doTipo('seller').filter((r) => vivo(r) && r.active).length,
    warehouses: doTipo('warehouse').filter((r) => vivo(r) && r.active).length,
    logistics: doTipo('logistics').filter((r) => vivo(r) && r.active).length,
  };
  const customerContactType = doTipo('contact_type').some((r) => vivo(r) && foldName(r.label) === 'cliente');

  const obrigatorios: boolean[] = [
    orderModule.state === 'ok',
    ...STATUS_ROLES.map((role) => statuses[role].state === 'ok'),
    ...transitions.map((t) => t.state === 'ok'),
    revenueRoot.state === 'ok',
    revenueCategories.some((c) => c.state === 'ok'),
    paymentMethods.length > 0 && paymentMethods.every((p) => p.state === 'ok'),
    customerContactType,
  ];
  const pending = obrigatorios.filter((ok) => !ok).length;

  return {
    settingsFromOtherCompany,
    orderModule,
    statuses,
    transitions,
    revenueRoot,
    revenueCategories,
    paymentMethods,
    counts,
    customerContactType,
    pending,
    green: pending === 0,
  };
}
