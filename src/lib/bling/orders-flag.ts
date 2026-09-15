/**
 * O que impede ligar os pedidos no Bling (086).
 *
 * O mínimo para um pedido montar: a empresa conectada é a dos papéis, a
 * situação Em aberto e a raiz das categorias foram confirmadas, e há ao menos
 * uma forma de pagamento. O resto da matriz (transições, compra futura) é da
 * Fase 5 e aparece na saúde, sem bloquear o envio do pedido Em aberto.
 */

export type OrdersBlocker =
  | 'no_settings'
  | 'company_mismatch'
  | 'no_open_status'
  | 'no_revenue_root'
  | 'no_payment_methods';

export interface FlagSettings {
  orders_enabled?: boolean | null;
  company_id?: string | null;
  status_open_id?: string | null;
  revenue_root_category_id?: string | null;
  payment_method_ids?: string[] | null;
}

export function ordersEnableBlockers(
  settings: FlagSettings | null | undefined,
  connectedCompanyId?: string | null
): OrdersBlocker[] {
  if (!settings) return ['no_settings'];
  const bloqueios: OrdersBlocker[] = [];
  if (connectedCompanyId && settings.company_id !== connectedCompanyId) bloqueios.push('company_mismatch');
  if (!settings.status_open_id) bloqueios.push('no_open_status');
  if (!settings.revenue_root_category_id) bloqueios.push('no_revenue_root');
  if (!settings.payment_method_ids?.length) bloqueios.push('no_payment_methods');
  return bloqueios;
}
