import type { SupabaseClient } from '@supabase/supabase-js';

import { categoriesUnderRoot, isUnderRoot, resolveProductCategory, suggestFamilyCategory } from './categories';
import type { BlingSettingsRow, Reference, RefPick } from './health';
import type { BlingProduct } from './products';

/**
 * O que a tela de produtos do Bling precisa, e as três decisões que só um
 * admin toma: resolver uma pendência, mapear uma família, escolher a
 * categoria padrão (esta pela rota de papéis).
 */

export interface CrmCatalogRow {
  id: string;
  name: string;
  sku: string | null;
  active: boolean;
  bling_product_id: string | null;
  bling_product_type: string | null;
  gross_weight_kg: number | null;
  bling_family_id: string | null;
  revenue_category_bling_id: string | null;
  defines_order_category: boolean;
}

export interface FamilyRow {
  id: string;
  label: string;
  parentId: string | null;
  depth: number;
  productCount: number;
  mapping: RefPick | null;
  mappingState: 'ok' | 'removed' | 'outside_root' | null;
  suggestion: RefPick | null;
}

export interface ProductsCounts {
  linked: number;
  active: number;
  /** Produto físico ativo sem peso bruto: bloqueia a emissão na Fase 3. */
  missingWeight: number;
  /** Ativo sem categoria de receita resolvida, ou resolvida fora da raiz. */
  unresolvedCategory: number;
  auxiliary: number;
}

export function buildProductsCounts(
  catalogo: CrmCatalogRow[],
  referencias: Reference[],
  mapaDeFamilias: ReadonlyMap<string, string>,
  settings: Pick<BlingSettingsRow, 'revenue_root_category_id' | 'default_revenue_category_id'> | null
): ProductsCounts {
  const familias = referencias.filter((r) => r.kind === 'product_category');
  const paiDaFamilia = new Map(familias.map((f) => [f.bling_id, f.parent_bling_id]));
  const categorias = referencias.filter((r) => r.kind === 'revenue_category');
  const paiDaCategoria = new Map(categorias.map((c) => [c.bling_id, c.parent_bling_id]));
  const categoriaViva = new Set(categorias.filter((c) => c.removed_at === null && c.active).map((c) => c.bling_id));
  const raiz = settings?.revenue_root_category_id ?? null;

  const vinculados = catalogo.filter((p) => p.bling_product_id);
  const ativos = vinculados.filter((p) => p.active);
  return {
    linked: vinculados.length,
    active: ativos.length,
    missingWeight: ativos.filter((p) => p.bling_product_type !== 'S' && p.bling_product_type !== 'N' && p.gross_weight_kg === null).length,
    unresolvedCategory: ativos.filter((p) => {
      const r = resolveProductCategory(p, mapaDeFamilias, paiDaFamilia, settings?.default_revenue_category_id ?? null);
      if (!r.categoryId || !categoriaViva.has(r.categoryId)) return true;
      return raiz ? !isUnderRoot(r.categoryId, raiz, paiDaCategoria) : true;
    }).length,
    auxiliary: ativos.filter((p) => !p.defines_order_category).length,
  };
}

export function buildFamilyRows(
  referencias: Reference[],
  catalogo: CrmCatalogRow[],
  mapaDeFamilias: ReadonlyMap<string, string>,
  raizId: string | null
): FamilyRow[] {
  const familias = referencias.filter((r) => r.kind === 'product_category' && r.removed_at === null);
  const categorias = referencias.filter((r) => r.kind === 'revenue_category');
  const paiDaCategoria = new Map(categorias.map((c) => [c.bling_id, c.parent_bling_id]));
  const sobARaiz = categoriesUnderRoot(referencias, raizId);
  const porFamilia = new Map<string, number>();
  for (const p of catalogo) {
    if (p.active && p.bling_family_id) porFamilia.set(p.bling_family_id, (porFamilia.get(p.bling_family_id) ?? 0) + 1);
  }

  const linhas: FamilyRow[] = [];
  const visitar = (paiId: string | null, profundidade: number) => {
    if (profundidade > 8) return;
    const filhas = familias
      .filter((f) => (f.parent_bling_id ?? null) === paiId)
      .sort((a, b) => a.label.localeCompare(b.label));
    for (const f of filhas) {
      const mapeada = mapaDeFamilias.get(f.bling_id) ?? null;
      const ref = mapeada ? categorias.find((c) => c.bling_id === mapeada) : undefined;
      linhas.push({
        id: f.bling_id,
        label: f.label,
        parentId: f.parent_bling_id,
        depth: profundidade,
        productCount: porFamilia.get(f.bling_id) ?? 0,
        mapping: mapeada ? { id: mapeada, label: ref?.label ?? mapeada } : null,
        mappingState: !mapeada
          ? null
          : !ref || ref.removed_at !== null
            ? 'removed'
            : raizId && !isUnderRoot(mapeada, raizId, paiDaCategoria)
              ? 'outside_root'
              : 'ok',
        suggestion: mapeada ? null : suggestFamilyCategory(f.label, sobARaiz),
      });
      visitar(f.bling_id, profundidade + 1);
    }
  };
  visitar(null, 0);
  // Família cujo pai não veio na sincronização: aparece na raiz, sem se perder.
  const vistas = new Set(linhas.map((l) => l.id));
  for (const f of familias.filter((x) => !vistas.has(x.bling_id))) {
    const mapeada = mapaDeFamilias.get(f.bling_id) ?? null;
    linhas.push({
      id: f.bling_id,
      label: f.label,
      parentId: f.parent_bling_id,
      depth: 0,
      productCount: porFamilia.get(f.bling_id) ?? 0,
      mapping: mapeada ? { id: mapeada, label: categorias.find((c) => c.bling_id === mapeada)?.label ?? mapeada } : null,
      mappingState: mapeada ? 'ok' : null,
      suggestion: mapeada ? null : suggestFamilyCategory(f.label, sobARaiz),
    });
  }
  return linhas;
}

export type FamilyPatch = Array<{ familyId: string; categoryId: string | null }>;

/** Só família que está no cache, e só categoria viva embaixo da raiz confirmada. */
export function validateFamilyPatch(
  body: unknown,
  referencias: Reference[],
  raizId: string | null
): { ok: true; mappings: FamilyPatch } | { ok: false; error: string } {
  const lista = (body as { mappings?: unknown } | null)?.mappings;
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > 500) {
    return { ok: false, error: 'mappings precisa ser uma lista com 1 a 500 itens' };
  }
  if (!raizId) return { ok: false, error: 'confirme a categoria raiz antes de mapear famílias' };

  const familias = new Set(referencias.filter((r) => r.kind === 'product_category' && r.removed_at === null).map((r) => r.bling_id));
  const validas = new Set(categoriesUnderRoot(referencias, raizId).map((c) => c.bling_id));
  const saida: FamilyPatch = [];
  for (const item of lista) {
    const familyId = (item as { familyId?: unknown })?.familyId;
    const categoryId = (item as { categoryId?: unknown })?.categoryId;
    if (typeof familyId !== 'string' || !familias.has(familyId)) {
      return { ok: false, error: `família ${String(familyId)} não está no Bling` };
    }
    if (categoryId !== null && (typeof categoryId !== 'string' || !validas.has(categoryId))) {
      return { ok: false, error: `categoria ${String(categoryId)} não está embaixo da raiz` };
    }
    saida.push({ familyId, categoryId: categoryId as string | null });
  }
  return { ok: true, mappings: saida };
}

/**
 * Os campos de um produto do CRM a partir do que a pendência guardou do Bling.
 * O mesmo recorte da importação: nome em 120, unidade em 16.
 */
export function productFieldsFromMatch(produto: Partial<BlingProduct>, agora: string): Record<string, unknown> {
  const cortar = (v: string, n: number) => (v.length <= n ? v : `${v.slice(0, n - 1)}…`);
  return {
    name: cortar(String(produto.name ?? '').trim() || '(sem nome)', 120),
    price: typeof produto.price === 'number' ? produto.price : null,
    active: produto.active !== false,
    unit: typeof produto.unit === 'string' && produto.unit ? cortar(produto.unit, 16) : null,
    bling_product_id: produto.id,
    bling_product_type: produto.type ?? null,
    gross_weight_kg: typeof produto.grossWeightKg === 'number' ? produto.grossWeightKg : null,
    net_weight_kg: typeof produto.netWeightKg === 'number' ? produto.netWeightKg : null,
    bling_family_id: produto.familyId ?? null,
    // Sem resumo: a próxima importação relê o detalhe e confirma.
    bling_synced_at: null,
    bling_list_hash: null,
    updated_at: agora,
  };
}

export type MatchAction =
  | { action: 'link'; productId: string }
  | { action: 'create' }
  | { action: 'ignore' };

export function parseMatchAction(body: unknown): MatchAction | null {
  const b = body as { action?: unknown; productId?: unknown } | null;
  if (b?.action === 'create' || b?.action === 'ignore') return { action: b.action };
  if (b?.action === 'link' && typeof b.productId === 'string' && b.productId) {
    return { action: 'link', productId: b.productId };
  }
  return null;
}

/**
 * Resolve uma pendência. Devolve o desfecho para a rota responder.
 *
 * `link` recusa produto de outra conta e produto já vinculado a OUTRO id do
 * Bling — é exatamente a ambiguidade que trouxe a pendência até aqui.
 */
export async function resolveMatch(
  db: SupabaseClient,
  contexto: { accountId: string; userId: string; matchId: string },
  acao: MatchAction,
  agora: string = new Date().toISOString()
): Promise<{ ok: true; productId: string | null } | { ok: false; status: number; error: string }> {
  const { data: pendencia } = await db
    .from('bling_product_matches')
    .select('id, account_id, bling_product_id, bling_code, status, payload')
    .eq('id', contexto.matchId)
    .eq('account_id', contexto.accountId)
    .maybeSingle();
  const p = pendencia as {
    id: string;
    bling_product_id: string;
    bling_code: string | null;
    status: string;
    payload: Partial<BlingProduct>;
  } | null;
  if (!p) return { ok: false, status: 404, error: 'not_found' };
  if (p.status !== 'pending') return { ok: false, status: 409, error: 'already_resolved' };

  const fechar = async (status: 'linked' | 'created' | 'ignored') =>
    db
      .from('bling_product_matches')
      .update({ status, resolved_by: contexto.userId, resolved_at: agora, updated_at: agora })
      .eq('id', p.id)
      .eq('status', 'pending');

  if (acao.action === 'ignore') {
    await fechar('ignored');
    return { ok: true, productId: null };
  }

  const payload = { ...p.payload, id: p.bling_product_id };

  // O id do Bling já pode ter sido vinculado por outra rodada ou outra pessoa.
  const { data: jaVinculado } = await db
    .from('products')
    .select('id')
    .eq('account_id', contexto.accountId)
    .eq('bling_product_id', p.bling_product_id)
    .maybeSingle();
  if (jaVinculado) return { ok: false, status: 409, error: 'bling_product_already_linked' };

  const codigo = p.bling_code && p.bling_code.trim() && p.bling_code.length <= 60 ? p.bling_code.trim() : null;
  const skuLivre = async (exceto: string | null) => {
    if (!codigo) return false;
    // `ilike` sem curinga: um código com % ou _ não pode casar outro código.
    const semCuringa = codigo.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data } = await db
      .from('products')
      .select('id')
      .eq('account_id', contexto.accountId)
      .ilike('sku', semCuringa)
      .limit(1);
    const dono = (data as Array<{ id: string }> | null)?.[0];
    return !dono || dono.id === exceto;
  };

  if (acao.action === 'link') {
    const { data: alvo } = await db
      .from('products')
      .select('id, bling_product_id')
      .eq('id', acao.productId)
      .eq('account_id', contexto.accountId)
      .maybeSingle();
    const produto = alvo as { id: string; bling_product_id: string | null } | null;
    if (!produto) return { ok: false, status: 404, error: 'product_not_found' };
    if (produto.bling_product_id && produto.bling_product_id !== p.bling_product_id) {
      return { ok: false, status: 409, error: 'product_linked_elsewhere' };
    }
    const campos = productFieldsFromMatch(payload, agora);
    if (await skuLivre(produto.id)) campos.sku = codigo;
    const { error } = await db.from('products').update(campos).eq('id', produto.id);
    if (error) return { ok: false, status: 500, error: 'save_failed' };
    await fechar('linked');
    return { ok: true, productId: produto.id };
  }

  const campos = productFieldsFromMatch(payload, agora);
  const { data: criado, error } = await db
    .from('products')
    .insert({
      account_id: contexto.accountId,
      currency: 'BRL',
      sku: (await skuLivre(null)) ? codigo : null,
      created_by: contexto.userId,
      ...campos,
    })
    .select('id')
    .single();
  if (error || !criado) return { ok: false, status: 500, error: 'save_failed' };
  await fechar('created');
  return { ok: true, productId: (criado as { id: string }).id };
}
