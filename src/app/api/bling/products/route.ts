import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isMissingObject, loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import { categoriesUnderRoot, resolveProductCategory } from '@/lib/bling/categories';
import type { BlingSettingsRow } from '@/lib/bling/health';
import { isJobRunning, loadJob } from '@/lib/bling/jobs';
import { buildFamilyRows, buildProductsCounts, type CrmCatalogRow } from '@/lib/bling/product-admin';
import { loadReferences } from '@/lib/bling/settings';

/**
 * Produtos do Bling em Configurações: a importação, as contagens que dizem se
 * o catálogo está pronto para pedido, as pendências e o mapa de famílias.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const db = blingAdmin();

    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state !== 'ok') return NextResponse.json({ connected: false });
    const { connection } = conexao;

    const catalogo: CrmCatalogRow[] = [];
    for (let inicio = 0; inicio < 100_000; inicio += 1000) {
      const { data, error } = await db
        .from('products')
        .select(
          'id, name, sku, active, bling_product_id, bling_product_type, gross_weight_kg, bling_family_id, revenue_category_bling_id, defines_order_category'
        )
        .eq('account_id', ctx.accountId)
        .order('id')
        .range(inicio, inicio + 999);
      if (error) {
        // 42703: as colunas da 084 ainda não existem.
        if (error.code === '42703' || isMissingObject(error)) {
          return NextResponse.json({ connected: true, pending: 84 });
        }
        throw new Error(error.message);
      }
      catalogo.push(...((data ?? []) as CrmCatalogRow[]));
      if ((data ?? []).length < 1000) break;
    }

    const [referencias, { data: settings }, { data: mapas, error: erroMapas }, job, { data: pendencias }] =
      await Promise.all([
        loadReferences(db, connection.id),
        db.from('bling_settings').select('*').eq('account_id', ctx.accountId).maybeSingle(),
        db
          .from('bling_family_categories')
          .select('family_bling_id, revenue_category_bling_id, company_id')
          .eq('account_id', ctx.accountId),
        loadJob(db, connection.id, 'products'),
        db
          .from('bling_product_matches')
          .select('id, bling_product_id, bling_code, bling_name, reason, candidate_product_id, created_at')
          .eq('account_id', ctx.accountId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);
    if (erroMapas && isMissingObject(erroMapas)) return NextResponse.json({ connected: true, pending: 84 });

    const s = settings as BlingSettingsRow | null;
    const valeParaEsta = s && s.company_id === connection.company_id ? s : null;
    const mapaDeFamilias = new Map(
      ((mapas ?? []) as Array<{ family_bling_id: string; revenue_category_bling_id: string; company_id: string }>)
        .filter((m) => m.company_id === connection.company_id)
        .map((m) => [m.family_bling_id, m.revenue_category_bling_id])
    );
    const raiz = valeParaEsta?.revenue_root_category_id ?? null;
    const porId = new Map(catalogo.map((p) => [p.id, p]));

    return NextResponse.json({
      connected: true,
      pending: null,
      job: job ? { ...job, running: isJobRunning(job) } : null,
      rootConfirmed: Boolean(raiz),
      counts: buildProductsCounts(catalogo, referencias, mapaDeFamilias, valeParaEsta),
      families: buildFamilyRows(referencias, catalogo, mapaDeFamilias, raiz),
      categoryOptions: categoriesUnderRoot(referencias, raiz)
        .filter((c) => c.active)
        .map((c) => ({ id: c.bling_id, label: c.label })),
      defaultCategoryId: valeParaEsta?.default_revenue_category_id ?? null,
      matches: ((pendencias ?? []) as Array<{
        id: string;
        bling_product_id: string;
        bling_code: string | null;
        bling_name: string;
        reason: string;
        candidate_product_id: string | null;
      }>).map((m) => {
        const candidato = m.candidate_product_id ? porId.get(m.candidate_product_id) : undefined;
        return {
          id: m.id,
          blingProductId: m.bling_product_id,
          code: m.bling_code,
          name: m.bling_name,
          reason: m.reason,
          candidate: candidato ? { id: candidato.id, name: candidato.name, sku: candidato.sku } : null,
        };
      }),
      unlinkedProducts: catalogo
        .filter((p) => !p.bling_product_id)
        .slice(0, 500)
        .map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
      // Para a lista de exceções: os vinculados ativos, com a categoria que
      // vale hoje e de onde ela vem.
      linkedProducts: (() => {
        const familias = referencias.filter((r) => r.kind === 'product_category');
        const paiDaFamilia = new Map(familias.map((f) => [f.bling_id, f.parent_bling_id]));
        const rotuloDaFamilia = new Map(familias.map((f) => [f.bling_id, f.label]));
        const rotuloDaCategoria = new Map(
          referencias.filter((r) => r.kind === 'revenue_category').map((c) => [c.bling_id, c.label])
        );
        return catalogo
          .filter((p) => p.bling_product_id && p.active)
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 3000)
          .map((p) => {
            const r = resolveProductCategory(p, mapaDeFamilias, paiDaFamilia, valeParaEsta?.default_revenue_category_id ?? null);
            return {
              id: p.id,
              name: p.name,
              sku: p.sku,
              family: p.bling_family_id ? (rotuloDaFamilia.get(p.bling_family_id) ?? p.bling_family_id) : null,
              missingWeight: p.bling_product_type !== 'S' && p.bling_product_type !== 'N' && p.gross_weight_kg === null,
              exceptionCategoryId: p.revenue_category_bling_id,
              definesOrderCategory: p.defines_order_category,
              category: r.categoryId ? { id: r.categoryId, label: rotuloDaCategoria.get(r.categoryId) ?? r.categoryId } : null,
              categorySource: r.source,
            };
          });
      })(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
