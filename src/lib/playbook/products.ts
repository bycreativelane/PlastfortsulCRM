import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeForSearch } from '@/lib/playbook/entries';
import type { ReferenceProduct } from '@/components/playbook/product-reference';

/**
 * Os produtos, para consulta — só os ativos, só as colunas da ficha.
 *
 * A mesma tabela `products` que o catálogo lê (migrações 054 e 055).
 * Nenhum dado duplicado: o que muda é a pergunta. O catálogo pergunta
 * "o que a empresa vende e o que preciso corrigir"; isto pergunta "o
 * cliente perguntou a micragem, qual é".
 *
 * `active = true` sem opção de ver os inativos. Um produto aposentado
 * continua existindo em toda oportunidade que já o conteve — é por isso
 * que ele é desativado e não apagado — mas oferecê-lo numa conversa é
 * prometer o que não se vende mais.
 */
const COLUMNS =
  'id, name, sku, description, unit, price, currency, category, size_label, thickness_micron, material, color';

export async function loadReferenceProducts(
  db: SupabaseClient,
  accountId: string
): Promise<ReferenceProduct[] | 'missing-table'> {
  const { data, error } = await db
    .from('products')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('active', true)
    .order('name');

  if (error) {
    // 42P01 tabela ausente, 42703 coluna ausente: a 054 ou a 055 não
    // foram aplicadas. A aba diz "ainda não está ligado" em vez de
    // quebrar — mesma regra do resto do produto.
    if (error.code === '42P01' || error.code === '42703')
      return 'missing-table';
    console.error('loadReferenceProducts failed', error);
    return [];
  }
  return (data ?? []) as unknown as ReferenceProduct[];
}

/**
 * A mesma busca dos outros três tipos, sobre os campos da ficha.
 *
 * `size_label` entra com os espaços removidos porque ele é gerado como
 * `40x60cm` e quem procura digita "40 x 60" — a coluna existe
 * exatamente para essa comparação, e o catálogo já faz o mesmo.
 */
export function matchesProduct(
  product: ReferenceProduct,
  query: string
): boolean {
  const q = normalizeForSearch(query.trim());
  if (!q) return true;
  const haystack = normalizeForSearch(
    [
      product.name,
      product.sku,
      product.category,
      product.material,
      product.color,
      product.description,
      (product.size_label ?? '').replace(/\s/g, ''),
      product.thickness_micron ? `${product.thickness_micron}` : '',
    ]
      .filter(Boolean)
      .join(' ')
  );
  return q
    .split(/\s+/)
    .every((word) => haystack.includes(word.replace(/\s/g, '')));
}
