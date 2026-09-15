import type { SupabaseClient } from '@supabase/supabase-js';

import { dealItemRows, type DealItemDraft } from '@/lib/products/catalog';

import { installmentRows, type InstallmentDraft } from './installments';

/**
 * GRAVAR A OPORTUNIDADE NUMA TRANSAÇÃO SÓ — pela `save_deal_order` da 078.
 *
 * ------------------------------------------------------------------
 * O DEFEITO
 * ------------------------------------------------------------------
 *
 * A gaveta gravava em três chamadas sem transação: a oportunidade, depois
 * apaga-e-insere dos itens, depois apaga-e-insere das parcelas. Uma falha
 * no meio deixava o pedido pela metade — cabeçalho novo com itens velhos,
 * ou sem itens nenhum (o DELETE passou, o INSERT não). Quando o pedido vai
 * para um ERP isso deixa de ser detalhe: um PUT no Bling montado a partir
 * de uma gravação pela metade mandaria itens errados.
 *
 * ------------------------------------------------------------------
 * E POR QUE ELE AINDA TEM UM CAMINHO ANTIGO
 * ------------------------------------------------------------------
 *
 * Porque a função mora numa migração aplicada à mão. Enquanto a 078 não
 * roda, ela não existe, e a gaveta grava como sempre gravou.
 *
 * Mais que isso: se a 078 foi aplicada e a função tiver um defeito, SALVAR
 * OPORTUNIDADE NÃO PODE QUEBRAR. É a mesma lição da regressão de 14 de
 * setembro, em que colunas de migração não aplicada derrubaram toda
 * gravação. Então o erro é classificado:
 *
 *   - a função não existe                → o caminho antigo, calado
 *   - permissão, ou dado inválido         → erro na tela; o caminho antigo
 *     (RLS, CHECK, FK, NOT NULL)            bateria na mesma parede
 *   - qualquer outra coisa                → o caminho antigo, com o erro no
 *                                           console para ninguém achar que
 *                                           a transação está funcionando
 */

export type SaveErrorKind = 'unavailable' | 'rejected' | 'broken';

export function classifySaveError(error: {
  code?: string | null;
  message?: string | null;
}): SaveErrorKind {
  const code = error.code ?? '';
  // PGRST202: o PostgREST não conhece a função (migração não aplicada, ou
  // o cache de esquema ainda não recarregou). 42883: o Postgres não achou.
  if (code === 'PGRST202' || code === '42883') return 'unavailable';
  // 42501: RLS ou "não encontrada ou sem permissão" — a função levanta
  // este código quando o UPDATE não casa linha nenhuma.
  // 23xxx: violação de integridade (CHECK, FK, NOT NULL, UNIQUE).
  // 22023: parâmetro inválido, levantado pela própria função.
  if (code === '42501' || code.startsWith('23') || code === '22023') {
    return 'rejected';
  }
  return 'broken';
}

export interface SaveDealOrderArgs {
  /** `null` cria. */
  dealId: string | null;
  /** A linha de `deals`, com os nomes das colunas (inclui `account_id` ao criar). */
  deal: Record<string, unknown>;
  /** `null` = não mexer nas linhas (catálogo ausente). */
  items: DealItemDraft[] | null;
  /** `null` = não mexer nas parcelas. */
  installments: InstallmentDraft[] | null;
}

export type SaveDealOrderResult =
  | { status: 'saved'; dealId: string }
  | { status: SaveErrorKind; error: string };

export async function saveDealOrder(
  db: SupabaseClient,
  args: SaveDealOrderArgs
): Promise<SaveDealOrderResult> {
  const { data, error } = await db.rpc('save_deal_order', {
    p_deal_id: args.dealId,
    p_deal: args.deal,
    p_items: args.items === null ? null : dealItemRows(args.items),
    p_installments:
      args.installments === null ? null : installmentRows(args.installments),
  });

  if (error) {
    return { status: classifySaveError(error), error: error.message };
  }
  if (typeof data !== 'string') {
    return { status: 'broken', error: 'save_deal_order não devolveu o id' };
  }
  return { status: 'saved', dealId: data };
}
