/**
 * AS TRAVAS DO PEDIDO POR SITUAÇÃO — o espelho, na gaveta, do gatilho
 * `guard_deal_order_columns` da 085.
 *
 * ------------------------------------------------------------------
 * QUEM TRAVA DE VERDADE É O BANCO
 * ------------------------------------------------------------------
 *
 * O gatilho recusa, para quem escreve como `authenticated`, qualquer mudança
 * fora das colunas livres da situação. Este arquivo existe para a gaveta
 * saber ANTES: desabilitar o campo que não pode mudar e, ao salvar, mandar
 * só as colunas livres. Sem ele, salvar um pedido Em andamento reenviaria o
 * frete e os itens como estão — iguais, mas o gatilho compara a linha
 * inteira e a gravação atômica (078) apaga e reinsere as linhas, o que ele
 * recusa em qualquer situação travada. Toda edição de observação morreria
 * com um erro de permissão.
 *
 * As três listas são as do SQL, e `order-lock.test.ts` lê a migração mais
 * nova que define o gatilho e confere uma contra a outra: uma coluna livre lá
 * e travada aqui é um campo apagado sem motivo; livre aqui e travada lá é
 * um "salvar" que falha.
 */

export const ORDER_STATUSES = [
  'em_aberto',
  'em_andamento',
  'atendido',
  'cancelado',
  'compra_futura',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(valor: unknown): valor is OrderStatus {
  return (
    typeof valor === 'string' &&
    (ORDER_STATUSES as readonly string[]).includes(valor)
  );
}

/** 'open' edita tudo · 'in_progress' congela o pedido · 'closed' só o CRM. */
export type OrderLock = 'open' | 'in_progress' | 'closed';

/** O estado do pedido no Bling — só o servidor muda. */
export const SERVER_COLUMNS = [
  'order_status',
  'bling_order_id',
  'bling_external_key',
  'bling_order_number',
  'sync_status',
  'sync_version',
  'sync_error',
  'last_synced_at',
  'accounts_launched_at',
  'stock_launched_at',
] as const;

/** O que é só do CRM: nunca vai ao Bling e muda em qualquer situação. */
export const CRM_COLUMNS = [
  'title',
  'notes',
  'internal_notes',
  'assigned_to',
  'pipeline_id',
  'stage_id',
  'stage_entered_at',
  'expected_close_date',
  'status',
  'lost_reason',
  'lost_note',
  'updated_at',
] as const;

/** Dados da produção, livres também em Em andamento. */
export const PRODUCTION_COLUMNS = [
  'departure_date',
  'expected_date',
  'delivery_days',
  'freight_volumes',
  'gross_weight',
  'freight_volumes_confirmed',
] as const;

/**
 * A regra de `deal_order_locked(status, launched)` da 085.
 *
 * Contas lançadas travam como Em andamento mesmo que a situação diga outra
 * coisa: é o lançamento que torna a edição perigosa, e não o rótulo.
 */
export function orderLock(
  status: string | null | undefined,
  accountsLaunchedAt: string | null | undefined
): OrderLock {
  if (status === 'atendido' || status === 'cancelado') return 'closed';
  if (status === 'em_andamento' || accountsLaunchedAt) return 'in_progress';
  return 'open';
}

/** As colunas que podem mudar nesta trava; `null` quando todas podem. */
export function freeColumns(lock: OrderLock): ReadonlySet<string> | null {
  if (lock === 'open') return null;
  return new Set<string>([
    ...CRM_COLUMNS,
    ...(lock === 'in_progress' ? PRODUCTION_COLUMNS : []),
  ]);
}

/** A coluna pode mudar nesta trava? */
export function isColumnFree(coluna: string, lock: OrderLock): boolean {
  const livres = freeColumns(lock);
  return livres === null || livres.has(coluna);
}

/**
 * O corpo de uma gravação reduzido ao que a trava deixa mudar.
 *
 * As colunas de servidor nunca saem daqui: a gaveta não as escreve em
 * situação nenhuma, e mandá-las iguais já seria mandar o que não é dela.
 */
export function pickFreeColumns<T extends Record<string, unknown>>(
  corpo: T,
  lock: OrderLock
): Partial<T> {
  const servidor = new Set<string>(SERVER_COLUMNS);
  const saida: Partial<T> = {};
  for (const [coluna, valor] of Object.entries(corpo)) {
    if (servidor.has(coluna)) continue;
    if (!isColumnFree(coluna, lock)) continue;
    (saida as Record<string, unknown>)[coluna] = valor;
  }
  return saida;
}

/**
 * O erro é a trava recusando?
 *
 * O gatilho levanta 42501 com `HINT = 'order_locked'`. 42501 sozinho também
 * é RLS, e as duas recusas pedem frases diferentes: "sem permissão" manda
 * procurar um admin; "pedido travado" manda mudar a situação.
 */
export function isOrderLockedError(error: {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
} | null | undefined): boolean {
  if (!error) return false;
  if (error.hint === 'order_locked') return true;
  return (
    error.code === '42501' &&
    /guard_deal_(order_columns|children_locked)/.test(error.message ?? '')
  );
}
