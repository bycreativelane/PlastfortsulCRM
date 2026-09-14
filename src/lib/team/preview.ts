import type { SupabaseClient } from '@supabase/supabase-js';

import {
  TEAM_SELECT,
  type TeamContentType,
  type TeamMessage,
} from './messages';

/**
 * A PRÉVIA DA SALA, para ler sem abrir.
 *
 * ------------------------------------------------------------------
 * O QUE VOLTA, E POR QUE VOLTA AGORA
 * ------------------------------------------------------------------
 *
 * O item 37 do pacote tirou do card do trilho as três linhas de histórico
 * que ele carregava, e o comentário do card registra o que se trocou: ele
 * passou a dizer que HÁ coisa nova, e não O QUE é. O Gabriel respondeu com
 * o uso, em 8 de setembro de 2026: "já que não tem mais o mini chat de
 * visualização, faz uma pré-visualização passando o mouse em cima pra ler
 * rápido".
 *
 * As duas decisões convivem, e é por isso que a prévia é um POPUP e não
 * linhas de volta no card. O card continua limpo em repouso — que é o que
 * o item 37 pediu —, e a conversa aparece para quem parou o ponteiro em
 * cima dela, que é justamente quem quer saber se vale abrir.
 *
 * ------------------------------------------------------------------
 * SÓ QUANDO ALGUÉM PASSA O MOUSE
 * ------------------------------------------------------------------
 *
 * O card vive em TODA rota. Buscar o histórico a cada navegação era o
 * custo que a remoção das três linhas eliminou (o comentário dele fala em
 * "pagar por um dado que ninguém mais lê"). Então a consulta só acontece
 * quando a prévia abre — e uma prévia é uma consulta de seis linhas.
 *
 * A prévia NÃO marca nada como lido. Ler por cima não é abrir a sala: quem
 * passou o mouse e decidiu responder depois precisa que o número continue
 * lá para lembrar.
 */

/** Quantas mensagens a prévia mostra. O bastante para uma pergunta e a resposta. */
export const PREVIEW_SIZE = 6;

export async function loadTeamPreview(
  db: SupabaseClient,
  accountId: string
): Promise<TeamMessage[]> {
  const { data, error } = await db
    .from('team_messages')
    // `*` e não uma lista de colunas: `content_type` e `media_name` só
    // existem depois da 063, e pedir uma coluna que não existe derruba a
    // leitura inteira. É a mesma escolha de `TEAM_SELECT`.
    .select(TEAM_SELECT)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(PREVIEW_SIZE);

  if (error) return [];
  // Mais nova por último, como a sala desenha — ler a prévia de cima para
  // baixo tem de ser ler a conversa na ordem em que ela aconteceu.
  return ((data ?? []) as TeamMessage[]).reverse();
}

export interface PreviewLabels {
  image: string;
  video: string;
  audio: string;
  document: string;
}

/**
 * O que a linha da prévia diz sobre uma mensagem.
 *
 * O texto quando há texto. Um anexo SEM legenda vira o nome do tipo —
 * "Imagem", "Áudio" — em vez de uma linha em branco, que leria como
 * mensagem apagada. Um documento leva o nome do arquivo junto, porque
 * "Documento" sozinho não ajuda a decidir se vale abrir e
 * "proposta-cotrisel.pdf" ajuda.
 */
export function previewText(
  // `body` aceita nulo aqui, e o tipo `TeamMessage` diz que não: desde a
  // 063 uma mensagem só de anexo grava o corpo como NULL (ver
  // `sendTeamMessage`). A prévia lê o banco como ele é.
  message: {
    body: string | null;
    content_type?: TeamContentType;
    media_name?: string | null;
  },
  labels: PreviewLabels
): { media: Exclude<TeamContentType, 'text'> | null; text: string } {
  const corpo = (message.body ?? '').trim();
  const tipo = message.content_type ?? 'text';

  if (tipo === 'text') return { media: null, text: corpo };

  if (corpo) return { media: tipo, text: corpo };

  if (tipo === 'document') {
    const nome = (message.media_name ?? '').trim();
    return {
      media: tipo,
      text: nome ? `${labels.document}: ${nome}` : labels.document,
    };
  }
  return { media: tipo, text: labels[tipo] };
}
