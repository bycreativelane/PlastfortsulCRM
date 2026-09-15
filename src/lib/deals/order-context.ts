import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveProductCategory } from '@/lib/bling/categories';
import type { Product } from '@/lib/products/catalog';

/**
 * O QUE A ÁREA PEDIDO PRECISA SABER DA CONTA — lido uma vez por abertura da
 * gaveta, sob a RLS de quem abriu.
 *
 * Transportadoras (085), as formas de pagamento confirmadas pelo admin, os
 * nomes das categorias de receita e o mapa família → categoria (083, 084).
 * Tudo tem política de SELECT para membros; nada aqui lê token nem conexão.
 *
 * Cada pedaço falha sozinho: um banco sem a 083 continua mostrando as
 * transportadoras, e um sem a 085 continua salvando oportunidade como antes.
 */

export interface Carrier {
  id: string;
  account_id: string;
  name: string;
  bling_contact_id: string | null;
  bling_contact_name: string | null;
  bling_logistics_id: string | null;
  bling_logistics_service_id: string | null;
  default_freight_payer_code: string | null;
  requires_freight_value: boolean;
  is_customer_pickup: boolean;
  active: boolean;
}

export interface NamedRef {
  id: string;
  label: string;
}

export interface OrderContext {
  /** As tabelas da 085 existem. */
  available: boolean;
  carriers: Carrier[];
  /** Há `bling_settings` para esta conta: o admin já passou pela configuração. */
  blingConfigured: boolean;
  /** As formas confirmadas pelo admin (`bling_settings.payment_method_ids`), com nome. */
  paymentMethods: NamedRef[];
  /** id → nome de toda categoria de receita conhecida. */
  categoryLabels: ReadonlyMap<string, string>;
  /** A categoria que a linha congela ao receber este produto. */
  resolveCategory: (product: Product) => string | null;
}

export const EMPTY_ORDER_CONTEXT: OrderContext = {
  available: false,
  carriers: [],
  blingConfigured: false,
  paymentMethods: [],
  categoryLabels: new Map(),
  resolveCategory: (product) => product.revenue_category_bling_id ?? null,
};

const TABELA_AUSENTE = ['PGRST205', '42P01'];

interface LinhaReferencia {
  kind: string;
  bling_id: string;
  parent_bling_id: string | null;
  label: string;
}

const PAGINA = 1000;

async function lerReferencias(db: SupabaseClient, accountId: string): Promise<LinhaReferencia[]> {
  const linhas: LinhaReferencia[] = [];
  for (let de = 0; de < 50 * PAGINA; de += PAGINA) {
    const { data, error } = await db
      .from('bling_references')
      .select('kind, bling_id, parent_bling_id, label')
      .eq('account_id', accountId)
      .in('kind', ['payment_method', 'revenue_category', 'product_category'])
      .is('removed_at', null)
      .order('bling_id', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) return linhas;
    linhas.push(...((data ?? []) as LinhaReferencia[]));
    if ((data ?? []).length < PAGINA) break;
  }
  return linhas;
}

/**
 * O mapa pronto para `resolveProductCategory`, e a função que a linha usa.
 * Pura, para ser testada sem banco.
 */
export function categoryResolver(args: {
  references: LinhaReferencia[];
  familyCategories: Array<{ family_bling_id: string; revenue_category_bling_id: string }>;
  defaultCategoryId: string | null;
}): (product: Product) => string | null {
  const familias = new Map(
    args.familyCategories.map((f) => [f.family_bling_id, f.revenue_category_bling_id])
  );
  const pais = new Map(
    args.references
      .filter((r) => r.kind === 'product_category')
      .map((r) => [r.bling_id, r.parent_bling_id])
  );
  return (product) =>
    resolveProductCategory(
      {
        revenue_category_bling_id: product.revenue_category_bling_id ?? null,
        bling_family_id: product.bling_family_id ?? null,
      },
      familias,
      pais,
      args.defaultCategoryId
    ).categoryId;
}

export async function loadOrderContext(
  db: SupabaseClient,
  accountId: string
): Promise<OrderContext> {
  const [transportadoras, ajustes, referencias, familias] = await Promise.all([
    db.from('carriers').select('*').eq('account_id', accountId).order('name'),
    db.from('bling_settings').select('*').eq('account_id', accountId).maybeSingle(),
    lerReferencias(db, accountId),
    db
      .from('bling_family_categories')
      .select('family_bling_id, revenue_category_bling_id, company_id')
      .eq('account_id', accountId),
  ]);

  const available = !(
    transportadoras.error && TABELA_AUSENTE.includes(transportadoras.error.code ?? '')
  );
  const settings = ajustes.error
    ? null
    : (ajustes.data as {
        company_id: string;
        payment_method_ids: string[] | null;
        default_revenue_category_id?: string | null;
      } | null);

  const nomesDeForma = new Map(
    referencias.filter((r) => r.kind === 'payment_method').map((r) => [r.bling_id, r.label])
  );
  const categoryLabels = new Map(
    referencias.filter((r) => r.kind === 'revenue_category').map((r) => [r.bling_id, r.label])
  );

  // Só o mapa da empresa conectada: um de outra empresa apontaria para
  // categorias que não existem nesta.
  const mapa = (
    (familias.error ? [] : (familias.data ?? [])) as Array<{
      family_bling_id: string;
      revenue_category_bling_id: string;
      company_id: string;
    }>
  ).filter((f) => settings && f.company_id === settings.company_id);

  return {
    available,
    carriers: available ? ((transportadoras.data ?? []) as Carrier[]) : [],
    blingConfigured: !!settings,
    paymentMethods: (settings?.payment_method_ids ?? [])
      .filter((id) => nomesDeForma.has(id))
      .map((id) => ({ id, label: nomesDeForma.get(id) as string })),
    categoryLabels,
    resolveCategory: settings
      ? categoryResolver({
          references: referencias,
          familyCategories: mapa,
          defaultCategoryId: settings.default_revenue_category_id ?? null,
        })
      : EMPTY_ORDER_CONTEXT.resolveCategory,
  };
}
