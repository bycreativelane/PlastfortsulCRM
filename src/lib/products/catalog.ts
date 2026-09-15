import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProductFacts } from '@/lib/deals/order-rules';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import { fromCents, lineTotalCents } from '@/lib/money';

/**
 * The catalogue.
 *
 * "Produtos" is in the original specification three times and was never
 * a table — §10 (an opportunity has products), §11 (a customer has
 * products of interest), §44 (campaign by product). All three were built
 * out of tags and free text, which is what you reach for when there is
 * no catalogue, and which cannot answer the three questions a catalogue
 * exists for: what did this deal contain, what is it worth, and who buys
 * it.
 *
 * See migration 054 for what this deliberately is not — stock control
 * and a tiered price book, both of which would be a different feature
 * and both of which are worse half-built than absent.
 */

export interface Product {
  id: string;
  account_id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit: string | null;
  price: number | null;
  currency: string;
  category: string | null;
  active: boolean;
  /**
   * Measurements, typed (migration 055).
   *
   * The unit is in the COLUMN NAME on purpose — see the note in the
   * migration. `size_label` is GENERATED ("40x60cm"), so the list, the
   * quote line and the assistant's answer cannot format it differently.
   *
   * All optional, and all absent on a pre-055 database: a catalogue of
   * services has none of them, and half-filled is a catalogue's normal
   * state.
   */
  width_cm?: number | null;
  height_cm?: number | null;
  thickness_micron?: number | null;
  material?: string | null;
  color?: string | null;
  size_label?: string | null;
  /**
   * Vínculo com o Bling (084). Com ele, nome, código, unidade, preço e
   * situação vêm do Bling, e a próxima importação sobrescreve o que for
   * editado aqui. Ausente num banco sem a 084.
   */
  bling_product_id?: string | null;
  gross_weight_kg?: number | null;
  /** P produto · S serviço · N serviço de comunicação (084). */
  bling_product_type?: string | null;
  bling_family_id?: string | null;
  /** A exceção de categoria do produto (084); a regra está em `lib/bling/categories.ts`. */
  revenue_category_bling_id?: string | null;
  /** `false` é item auxiliar: não decide a categoria do pedido (D7). */
  defines_order_category?: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface DealItem {
  id: string;
  account_id: string;
  deal_id: string;
  product_id: string | null;
  /** Frozen at the moment the line was added — see 054. */
  name: string;
  /**
   * Codigo e unidade, congelados junto com o nome — migracao 075.
   *
   * O documento do Bling imprime as duas colunas ao lado da descricao, e
   * congelar e a mesma decisao que a 054 tomou para o `name`: um orcamento
   * de junho tem de mostrar o SKU de junho, e nao o que o produto tem hoje.
   *
   * Opcionais, e nao so porque a linha pode ser texto livre: numa base
   * anterior a 075 as colunas nao existem, e a leitura cai para o conjunto
   * antigo em vez de falhar.
   */
  sku?: string | null;
  unit?: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  /** GENERATED in the database. Never write it. */
  total: number;
  position: number;
  /**
   * O que o documento e o Bling precisam, congelado na linha (085): preço de
   * lista, peso bruto unitário, o produto no Bling, a categoria e se o item
   * decide a categoria. Ausentes num banco sem a 085.
   */
  list_price?: number | string | null;
  unit_gross_weight_kg?: number | string | null;
  bling_product_id?: string | null;
  revenue_category_bling_id?: string | null;
  defines_order_category?: boolean | null;
  bling_product_type?: string | null;
}

/**
 * Everything after 055, and everything before it.
 *
 * The same ladder every other feature in this codebase uses: naming a
 * column the database has not got is a 42703 for the WHOLE row, and this
 * row is the catalogue — losing it entirely to gain a measurement column
 * would be the wrong trade.
 */
const PRODUCT_COLUMNS_BASE =
  'id, account_id, name, sku, description, unit, price, currency, category, active, created_at, updated_at';

const PRODUCT_SELECT = `${PRODUCT_COLUMNS_BASE}, width_cm, height_cm, thickness_micron, material, color, size_label`;

/**
 * O degrau da 084: o vínculo com o Bling, o peso que veio de lá, o tipo, a
 * família e a exceção de categoria — o que a linha do pedido congela (085).
 */
const PRODUCT_SELECT_084 = `${PRODUCT_SELECT}, bling_product_id, gross_weight_kg, bling_product_type, bling_family_id, revenue_category_bling_id, defines_order_category`;

const ITEM_SELECT =
  'id, account_id, deal_id, product_id, name, sku, unit, quantity, unit_price, discount_percent, total, position';

/** As colunas de snapshot da 085 em `deal_items`. */
export const ITEM_SNAPSHOT_COLUMNS = [
  'list_price',
  'unit_gross_weight_kg',
  'bling_product_id',
  'revenue_category_bling_id',
  'defines_order_category',
  'bling_product_type',
] as const;

const ITEM_SELECT_085 = `${ITEM_SELECT}, ${ITEM_SNAPSHOT_COLUMNS.join(', ')}`;

/**
 * O mesmo conjunto sem o que a 075 acrescentou.
 *
 * As migracoes deste projeto sao aplicadas a mao, de proposito, e isso
 * abre uma janela em que o codigo pede uma coluna que o banco ainda nao
 * tem. Pedir `sku` a um banco pre-075 nao devolve a linha sem o campo:
 * devolve ERRO, e a oportunidade abriria sem nenhum produto. Entao a
 * leitura tenta o conjunto novo e cai para este.
 */
const ITEM_SELECT_PRE_075 =
  'id, account_id, deal_id, product_id, name, quantity, unit_price, discount_percent, total, position';

/**
 * `products` and `deal_items` arrive with migration 054, applied by
 * hand. Same pair every other feature in this codebase watches for.
 */
export function isMissingCatalog(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return (
    /products|deal_items/i.test(error.message ?? '') &&
    /(does not exist|could not find)/i.test(error.message ?? '')
  );
}

/**
 * Every product in the account.
 *
 * `'missing-table'` and `[]` are different answers and every caller has
 * to tell them apart: the first draws "this needs migration 054", the
 * second draws "add your first product". Showing the second over the
 * first tells somebody the feature works and invites them to type into
 * a form that will fail.
 */
export async function loadProducts(
  db: SupabaseClient,
  accountId: string,
  opts: { includeInactive?: boolean } = {}
): Promise<Product[] | 'missing-table'> {
  // A escada: 084, depois 055, depois o conjunto de 054. Uma coluna que o
  // banco ainda não tem derruba a leitura inteira, e aqui a leitura é o
  // catálogo.
  let widest = db
    .from('products')
    .select(PRODUCT_SELECT_084)
    .eq('account_id', accountId);
  if (!opts.includeInactive) widest = widest.eq('active', true);
  const top = await widest.order('name', { ascending: true });
  let data = top.data as Product[] | null;
  let error = top.error;

  if (error && isUnknownColumn(error)) {
    let query = db
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('account_id', accountId);
    if (!opts.includeInactive) query = query.eq('active', true);
    const wide = await query.order('name', { ascending: true });
    data = wide.data as Product[] | null;
    error = wide.error;
  }

  if (error && isUnknownColumn(error)) {
    let narrow = db
      .from('products')
      .select(PRODUCT_COLUMNS_BASE)
      .eq('account_id', accountId);
    if (!opts.includeInactive) narrow = narrow.eq('active', true);
    const fallback = await narrow.order('name', { ascending: true });
    data = fallback.data as Product[] | null;
    error = fallback.error;
  }

  if (error) {
    if (isMissingCatalog(error)) return 'missing-table';
    console.error('Failed to load products:', error.message);
    return [];
  }
  return data ?? [];
}

export interface ProductDraft {
  name: string;
  sku: string;
  description: string;
  unit: string;
  price: number | null;
  currency: string;
  category: string;
  /** Migration 055. Left out of the write when the columns are absent. */
  widthCm: number | null;
  heightCm: number | null;
  thicknessMicron: number | null;
  material: string;
  color: string;
}

/** Columns that only exist after 055. */
const DIMENSION_COLUMNS = [
  'width_cm',
  'height_cm',
  'thickness_micron',
  'material',
  'color',
];

/**
 * The 055 half of a draft.
 *
 * Split out because both writers need it and both need the same
 * behaviour on a database that has not caught up: send them, and on a
 * 42703 send the write again without them.
 */
function dimensions(draft: Partial<ProductDraft>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (draft.widthCm !== undefined) out.width_cm = draft.widthCm;
  if (draft.heightCm !== undefined) out.height_cm = draft.heightCm;
  if (draft.thicknessMicron !== undefined) {
    out.thickness_micron = draft.thicknessMicron;
  }
  if (draft.material !== undefined) out.material = draft.material.trim() || null;
  if (draft.color !== undefined) out.color = draft.color.trim() || null;
  return out;
}

export async function createProduct(
  db: SupabaseClient,
  accountId: string,
  createdBy: string | null,
  draft: ProductDraft
): Promise<{ product: Product | null; error: string | null }> {
  const name = draft.name.trim();
  if (!name) return { product: null, error: 'empty' };

  const { data, error } = await db
    .from('products')
    .insert({
      account_id: accountId,
      created_by: createdBy,
      name,
      // Empty string and NULL are the same intention here — "no code" —
      // and only one of them survives the partial unique index without
      // colliding with the next product that also has no code.
      sku: draft.sku.trim() || null,
      description: draft.description.trim() || null,
      unit: draft.unit.trim() || null,
      price: draft.price,
      currency: draft.currency,
      category: draft.category.trim() || null,
      ...dimensions(draft),
    })
    .select(PRODUCT_SELECT)
    .single();

  if (error && isUnknownColumn(error)) {
    // Pre-055. A catalogue that refuses a product because the database
    // has not caught up is worse than a product with no measurements.
    const retry = await db
      .from('products')
      .insert({
        account_id: accountId,
        created_by: createdBy,
        name,
        sku: draft.sku.trim() || null,
        description: draft.description.trim() || null,
        unit: draft.unit.trim() || null,
        price: draft.price,
        currency: draft.currency,
        category: draft.category.trim() || null,
      })
      .select(PRODUCT_COLUMNS_BASE)
      .single();
    if (retry.error) {
      return { product: null, error: describeWriteError(retry.error) };
    }
    return { product: retry.data as Product, error: null };
  }

  if (error) return { product: null, error: describeWriteError(error) };
  return { product: data as Product, error: null };
}

export async function updateProduct(
  db: SupabaseClient,
  id: string,
  draft: Partial<ProductDraft> & { active?: boolean }
): Promise<{ error: string | null }> {
  const patch: Record<string, unknown> = {};
  if (draft.name !== undefined) patch.name = draft.name.trim();
  if (draft.sku !== undefined) patch.sku = draft.sku.trim() || null;
  if (draft.description !== undefined) {
    patch.description = draft.description.trim() || null;
  }
  if (draft.unit !== undefined) patch.unit = draft.unit.trim() || null;
  if (draft.price !== undefined) patch.price = draft.price;
  if (draft.currency !== undefined) patch.currency = draft.currency;
  if (draft.category !== undefined) {
    patch.category = draft.category.trim() || null;
  }
  if (draft.active !== undefined) patch.active = draft.active;
  Object.assign(patch, dimensions(draft));

  if (Object.keys(patch).length === 0) return { error: null };

  const { error } = await db.from('products').update(patch).eq('id', id);
  if (error && isUnknownColumn(error)) {
    for (const key of DIMENSION_COLUMNS) delete patch[key];
    if (Object.keys(patch).length === 0) return { error: null };
    const retry = await db.from('products').update(patch).eq('id', id);
    return { error: retry.error ? describeWriteError(retry.error) : null };
  }
  return { error: error ? describeWriteError(error) : null };
}

/**
 * A duplicate code is the one write failure worth naming.
 *
 * The partial unique index in 054 exists because of a specific,
 * documented complaint about another CRM — "a plataforma permite
 * duplicar registros sem restrições na importação". A catalogue with the
 * same SKU twice is a catalogue where the price somebody quotes depends
 * on which row the query hit. Postgres reports it as 23505; a raw
 * constraint name in a toast would be true and useless.
 */
function describeWriteError(error: {
  code?: string | null;
  message?: string | null;
}): string {
  if (error.code === '23505') return 'duplicate-sku';
  // 42501 is `guard_product_active` (055) refusing a retire or a restore
  // from somebody who is not an admin. Correcting a price is the work of
  // whoever quotes it; taking a product out of everybody's catalogue is
  // not the same act.
  if (error.code === '42501') return 'admin-only';
  if (isMissingCatalog(error)) return 'missing-table';
  return error.message ?? 'unknown';
}

// ------------------------------------------------------------------
// Line items
// ------------------------------------------------------------------

export async function loadDealItems(
  db: SupabaseClient,
  dealId: string
): Promise<DealItem[] | 'missing-table'> {
  const ler = (colunas: string) =>
    db
      .from('deal_items')
      .select(colunas)
      .eq('deal_id', dealId)
      .order('position', { ascending: true });

  let { data, error } = await ler(ITEM_SELECT_085);

  // Sem os snapshots da 085, o conjunto da 075.
  if (error && isUnknownColumn(error)) {
    ({ data, error } = await ler(ITEM_SELECT));
  }

  // A janela entre escrever a 075 e aplica-la. Sem esta segunda tentativa
  // a gaveta abriria com "nenhum produto" numa oportunidade que tem tres.
  if (error && isUnknownColumn(error)) {
    ({ data, error } = await ler(ITEM_SELECT_PRE_075));
  }

  if (error) {
    if (isMissingCatalog(error)) return 'missing-table';
    console.error('Failed to load deal items:', error.message);
    return [];
  }
  return (data ?? []) as unknown as DealItem[];
}

export interface DealItemDraft {
  productId: string | null;
  name: string;
  /** Codigo e unidade, congelados na linha — ver `DealItem`. */
  sku?: string | null;
  unit?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  /**
   * Os snapshots da 085, tirados do produto na hora em que ele entra na
   * linha (`itemSnapshot`). Opcionais: texto livre não tem de onde tirar, e
   * uma linha lida de um banco sem a 085 não os traz.
   */
  listPrice?: number | null;
  unitGrossWeightKg?: number | null;
  blingProductId?: string | null;
  revenueCategoryBlingId?: string | null;
  definesOrderCategory?: boolean;
  blingProductType?: string | null;
}

/**
 * O que a linha congela do produto — preço de lista, peso, vínculo, tipo e a
 * categoria RESOLVIDA naquele momento (exceção do produto → família → padrão).
 *
 * A categoria vem de fora (`resolver`) porque ela depende do mapa de
 * famílias da conta, que o catálogo não carrega. Sem ele — conta sem Bling —
 * vale a exceção do próprio produto, ou nada.
 */
export function itemSnapshot(
  product: Product | null | undefined,
  resolver?: (product: Product) => string | null
): Pick<
  DealItemDraft,
  | 'listPrice'
  | 'unitGrossWeightKg'
  | 'blingProductId'
  | 'revenueCategoryBlingId'
  | 'definesOrderCategory'
  | 'blingProductType'
> {
  if (!product) {
    return {
      listPrice: null,
      unitGrossWeightKg: null,
      blingProductId: null,
      revenueCategoryBlingId: null,
      definesOrderCategory: true,
      blingProductType: null,
    };
  }
  const numero = (v: unknown) =>
    v === null || v === undefined || v === '' ? null : Number(v);
  return {
    listPrice: numero(product.price),
    unitGrossWeightKg: numero(product.gross_weight_kg),
    blingProductId: product.bling_product_id ?? null,
    revenueCategoryBlingId: resolver
      ? resolver(product)
      : (product.revenue_category_bling_id ?? null),
    definesOrderCategory: product.defines_order_category !== false,
    blingProductType: product.bling_product_type ?? null,
  };
}

/**
 * O que a linha deveria ter congelado do produto COMO ELE ESTÁ AGORA — o
 * vínculo, o tipo, a categoria resolvida e "define a categoria". A gaveta e
 * o servidor comparam o snapshot da linha com isto (`snapshotMatches`): uma
 * linha montada antes de o produto mudar no Bling não vai ao pedido.
 */
export function productFacts(
  product: Product,
  resolver?: (product: Product) => string | null
): ProductFacts {
  const snapshot = itemSnapshot(product, resolver);
  return {
    blingProductId: snapshot.blingProductId ?? null,
    blingProductType: snapshot.blingProductType ?? null,
    revenueCategoryBlingId: snapshot.revenueCategoryBlingId ?? null,
    definesOrderCategory: snapshot.definesOrderCategory !== false,
  };
}

/**
 * Replace a deal's lines with this set.
 *
 * DELETE-THEN-INSERT rather than a diff, and the reason is honesty about
 * what this is: the editor hands back the list as it should end up, and
 * a diff would be three code paths to arrive at the same state. The
 * `deals.value` trigger fires either way — it recomputes from whatever
 * rows exist after the write.
 *
 * The one thing it must not do is leave a deal with no lines when the
 * insert fails after the delete. So the insert is attempted first, into
 * a transaction the client cannot open... which PostgREST cannot do — so
 * the delete happens last on the happy path only, and the caller reloads
 * from the database rather than trusting local state.
 */
/**
 * As linhas como o banco as grava — sem conta e sem oportunidade.
 *
 * Uma função só para os dois caminhos de gravação: este aqui, em três
 * chamadas, e `save_deal_order` (078), numa transação. Se cada um
 * normalizasse por conta própria, um cortaria o nome em 160 e o outro não,
 * e a mesma oportunidade gravaria diferente conforme a migração aplicada.
 *
 * Linha sem nome ou com quantidade zero não é linha: é o formulário no
 * meio de uma edição.
 */
export function dealItemRows(items: DealItemDraft[]) {
  return items
    .filter((item) => item.name.trim() && item.quantity > 0)
    .map((item, index) => ({
      product_id: item.productId,
      name: item.name.trim().slice(0, 160),
      sku: (item.sku ?? '').trim().slice(0, 60) || null,
      unit: (item.unit ?? '').trim().slice(0, 16) || null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount_percent: item.discountPercent,
      position: index,
      // Os snapshots da 085. A `save_deal_order` anterior a ela lê as chaves
      // que conhece e ignora estas; o caminho direto tira-as num banco sem
      // as colunas (ver `replaceDealItems`).
      list_price: item.listPrice ?? null,
      unit_gross_weight_kg: item.unitGrossWeightKg ?? null,
      bling_product_id: item.blingProductId ?? null,
      revenue_category_bling_id: item.revenueCategoryBlingId ?? null,
      defines_order_category: item.definesOrderCategory !== false,
      bling_product_type: item.blingProductType ?? null,
    }));
}

export async function replaceDealItems(
  db: SupabaseClient,
  args: { accountId: string; dealId: string; items: DealItemDraft[] }
): Promise<{ error: string | null }> {
  const rows = dealItemRows(args.items).map((row) => ({
    account_id: args.accountId,
    deal_id: args.dealId,
    ...row,
  }));

  const { error: delError } = await db
    .from('deal_items')
    .delete()
    .eq('deal_id', args.dealId);
  if (delError) return { error: describeWriteError(delError) };

  if (rows.length === 0) return { error: null };

  let { error } = await db.from('deal_items').insert(rows);

  // Sem os snapshots num banco anterior à 085 — o mesmo raciocínio de
  // sku/unit logo abaixo, um degrau acima.
  if (error && isUnknownColumn(error)) {
    const sem085 = rows.map((row) => {
      const resto: Record<string, unknown> = { ...row };
      for (const coluna of ITEM_SNAPSHOT_COLUMNS) delete resto[coluna];
      return resto;
    });
    ({ error } = await db.from('deal_items').insert(sem085));
  }

  /*
   * Sem `sku`/`unit` num banco anterior a 075.
   *
   * A alternativa seria recusar a gravacao inteira, e ela custa mais do
   * que as duas colunas valem: quem salvasse uma oportunidade nessa
   * janela perderia as LINHAS — o delete acima ja passou. O codigo do
   * produto reaparece assim que a migracao rodar e alguem reeditar.
   */
  if (error && isUnknownColumn(error)) {
    const antigas = rows.map(({ sku: _sku, unit: _unit, ...resto }) => {
      const semSnapshot: Record<string, unknown> = { ...resto };
      for (const coluna of ITEM_SNAPSHOT_COLUMNS) delete semSnapshot[coluna];
      return semSnapshot;
    });
    ({ error } = await db.from('deal_items').insert(antigas));
  }

  return { error: error ? describeWriteError(error) : null };
}

/**
 * What one line is worth. The database computes the stored copy.
 *
 * Em CENTAVOS EXATOS por baixo (`lib/money.ts`), e não mais em float.
 * A versão anterior era `Math.round(q * p * (1 - d / 100) * 100) / 100`,
 * que discorda da coluna GENERATED da 054 no meio centavo — medido contra
 * o banco: 3 × R$ 0,35 com 50 % saía R$ 0,52 aqui e R$ 0,53 lá.
 */
export function lineTotal(item: {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}): number {
  return fromCents(lineTotalCents(item));
}
