import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Os arquivos de um orçamento arquivado: quando reaproveitar, quando
 * preencher, e como gravar os links.
 *
 * ------------------------------------------------------------------
 * O DEFEITO QUE ISTO FECHA
 * ------------------------------------------------------------------
 *
 * Os links nunca eram gravados (ver `admin-client.ts`), e a rota tinha
 * dois pontos que liam uma linha já arquivada com a mesma impressão
 * digital:
 *
 *   - antes do insert, ela reaproveitava a linha COM arquivo e
 *     preenchia a linha SEM arquivo — certo;
 *   - depois do `23505` (dois cliques simultâneos), ela devolvia a linha
 *     vencedora de qualquer jeito, inclusive sem arquivo — e a tela
 *     recebia `pdfUrl: null` sobre um orçamento que só não tinha sido
 *     desenhado ainda.
 *
 * Com os links nunca gravados, TODA linha estava "sem arquivo": o
 * reaproveitamento nunca acontecia (o Chromium subia a cada clique) e o
 * segundo clique simultâneo sempre voltava sem link. A decisão agora é
 * uma função só, usada nos dois pontos.
 */

export interface ArchivedQuoteFiles {
  id: string;
  pdf_url: string | null;
  image_url: string | null;
}

/**
 * - `reuse`: já tem arquivo — devolve os links, sem Chromium e sem upload.
 * - `fill`: a linha existe mas o documento não foi desenhado (uma tentativa
 *   que morreu no meio, ou os links que a RLS descartava) — desenha e
 *   preenche ESTA linha, sem inserir outra.
 * - `new`: não há linha — arquiva uma.
 */
export type FilesDecision = 'reuse' | 'fill' | 'new';

export function filesDecision(
  linha: ArchivedQuoteFiles | null | undefined
): FilesDecision {
  if (!linha) return 'new';
  return linha.pdf_url ? 'reuse' : 'fill';
}

export interface UploadedFile {
  caminho: string;
  url: string;
}

/**
 * Grava os quatro campos de arquivo de UMA linha, e só eles.
 *
 * Filtrado por id E conta, e com `select('id')` para saber se casou: um
 * update que não encontra linha não é erro no PostgREST, e foi exatamente
 * esse silêncio que escondeu o defeito por semanas.
 */
export async function attachQuoteFiles(
  admin: SupabaseClient,
  args: {
    quoteId: string;
    accountId: string;
    pdf: UploadedFile | null;
    png: UploadedFile | null;
  }
): Promise<{ error: string | null }> {
  const { data, error } = await admin
    .from('deal_quotes')
    .update({
      pdf_path: args.pdf?.caminho ?? null,
      pdf_url: args.pdf?.url ?? null,
      image_path: args.png?.caminho ?? null,
      image_url: args.png?.url ?? null,
    })
    .eq('id', args.quoteId)
    .eq('account_id', args.accountId)
    .select('id');

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'nenhuma linha de orçamento casou com id e conta' };
  }
  return { error: null };
}
