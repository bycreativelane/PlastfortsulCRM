import { foldName, type Reference, type RefPick } from './health';

/**
 * A categoria de receita de um produto, e a do pedido — D7.
 *
 * Pura: recebe o produto, o mapa família → categoria, a árvore de famílias e
 * a categoria padrão, e diz qual categoria vale e DE ONDE ela veio. "De onde"
 * importa para a tela: "Sacos de lixo (pela família)" e "Outros produtos
 * (padrão)" pedem ações diferentes de quem confere.
 */

export interface ProductCategoryInput {
  revenue_category_bling_id: string | null;
  bling_family_id: string | null;
}

export type CategorySource = 'product' | 'family' | 'default';

export interface ResolvedCategory {
  categoryId: string | null;
  source: CategorySource | null;
  /** A família que decidiu, quando foi pela família (pode ser um ancestral). */
  familyId: string | null;
}

const PROFUNDIDADE_MAXIMA = 10;

export function resolveProductCategory(
  produto: ProductCategoryInput,
  mapaDeFamilias: ReadonlyMap<string, string>,
  paiDaFamilia: ReadonlyMap<string, string | null>,
  categoriaPadrao: string | null
): ResolvedCategory {
  if (produto.revenue_category_bling_id) {
    return { categoryId: produto.revenue_category_bling_id, source: 'product', familyId: null };
  }

  // Sobe pela árvore: "Sacos > Sacos para silagem > 200 micras" herda o mapa
  // de "Sacos para silagem" se "200 micras" não tiver o seu. Um ciclo no cache
  // não trava: a profundidade é limitada e os visitados são lembrados.
  const visitadas = new Set<string>();
  let familia = produto.bling_family_id;
  for (let passo = 0; familia && passo < PROFUNDIDADE_MAXIMA && !visitadas.has(familia); passo++) {
    visitadas.add(familia);
    const categoria = mapaDeFamilias.get(familia);
    if (categoria) return { categoryId: categoria, source: 'family', familyId: familia };
    familia = paiDaFamilia.get(familia) ?? null;
  }

  if (categoriaPadrao) return { categoryId: categoriaPadrao, source: 'default', familyId: null };
  return { categoryId: null, source: null, familyId: null };
}

/** A categoria está na árvore da raiz confirmada ("Venda direta")? */
export function isUnderRoot(
  categoriaId: string,
  raizId: string,
  paiDaCategoria: ReadonlyMap<string, string | null>
): boolean {
  const visitadas = new Set<string>();
  let atual: string | null = categoriaId;
  for (let passo = 0; atual && passo < PROFUNDIDADE_MAXIMA && !visitadas.has(atual); passo++) {
    if (atual === raizId) return true;
    visitadas.add(atual);
    atual = paiDaCategoria.get(atual) ?? null;
  }
  return false;
}

/**
 * A categoria de receita com o mesmo nome da família, entre as que estão
 * embaixo da raiz — "Sacos para silagem" → "Venda direta > Sacos para
 * silagem". Só sugestão: o admin confirma (a especificação veda resolver pelo
 * nome na hora de salvar).
 */
export function suggestFamilyCategory(
  rotuloDaFamilia: string,
  categoriasSobARaiz: ReadonlyArray<Reference>
): RefPick | null {
  const alvo = foldName(rotuloDaFamilia);
  const vivas = categoriasSobARaiz.filter((c) => c.removed_at === null && c.active);
  const igual = vivas.find((c) => foldName(c.label) === alvo);
  if (igual) return { id: igual.bling_id, label: igual.label };
  // "Sacolas boca de palhaço" × "Sacolas Boca de palhaço": já coberto pelo
  // fold. Plural e singular ("Saco de lixo" × "Sacos de lixo") ficam para o
  // admin — uma regra de plural aqui erraria em outra família.
  return null;
}

/** As categorias de receita embaixo da raiz (sem a raiz), vivas. */
export function categoriesUnderRoot(referencias: ReadonlyArray<Reference>, raizId: string | null): Reference[] {
  if (!raizId) return [];
  const categorias = referencias.filter((r) => r.kind === 'revenue_category');
  const pai = new Map(categorias.map((c) => [c.bling_id, c.parent_bling_id]));
  return categorias.filter(
    (c) => c.bling_id !== raizId && c.removed_at === null && isUnderRoot(c.bling_id, raizId, pai)
  );
}
