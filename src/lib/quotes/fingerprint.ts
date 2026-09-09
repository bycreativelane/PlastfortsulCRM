import { createHash } from 'node:crypto';

import type { Quote } from './quote';

/**
 * A impressão digital de um orçamento: o que ele DIZ, resumido.
 *
 * ------------------------------------------------------------------
 * POR QUE ELA EXISTE
 * ------------------------------------------------------------------
 *
 * A 071 guarda uma linha por GERAÇÃO, e o argumento dela continua de pé:
 * o negócio muda depois que o orçamento sai, e o que o cliente recebeu
 * foi a versão daquele dia — sobrescrever apagaria justamente isso.
 *
 * O argumento estava certo e a implementação, errada. Ele vale quando o
 * CONTEÚDO muda. Apertar "Gerar PDF" oito vezes produzia oito linhas
 * idênticas, no mesmo segundo, com o mesmo total — e isso não é
 * histórico, é ruído. O Gabriel mandou o print com as oito.
 *
 * A regra passa a ser a que ele descreveu: guardado por data × produto ×
 * cliente × e o resto. Mesmo conteúdo, mesma linha; qualquer coisa
 * diferente, linha nova.
 *
 * De quebra some o custo: um clique repetido não sobe mais um Chromium
 * para desenhar de novo o que já está no bucket.
 *
 * ------------------------------------------------------------------
 * O QUE ENTRA, E POR QUE A ORDEM É ESCRITA À MÃO
 * ------------------------------------------------------------------
 *
 * Tudo que o documento IMPRIME, e nada além. Se dois documentos saem com
 * os mesmos pixels, são o mesmo documento.
 *
 * A data entra, e é o que faz "por geração de data" funcionar: o mesmo
 * orçamento gerado amanhã é outro documento, porque a folha diz outra
 * data.
 *
 * `dealId` entra porque duas oportunidades podem coincidir em tudo — dois
 * pedidos iguais para o mesmo cliente no mesmo dia — e ainda assim serem
 * dois negócios.
 *
 * A sequência é montada CAMPO A CAMPO em vez de `JSON.stringify(quote)`.
 * A ordem das chaves de um objeto é uma promessa que ninguém fez: basta
 * alguém reordenar uma propriedade em `buildQuote` para toda linha
 * existente deixar de casar e o arquivo encher de duplicatas de novo —
 * silenciosamente, que é o pior jeito.
 */

/**
 * O separador entre campos: U+001F, o "Unit Separator" do ASCII.
 *
 * Escrito como escape e nunca como o caractere em si, que é invisível no
 * editor. Um separador que não se enxerga é um separador que alguém
 * apaga sem perceber — e a primeira versão deste arquivo saiu com ele
 * virando string VAZIA numa passagem por shell, o que é precisamente a
 * colisão descrita abaixo.
 *
 * Ele existe porque a sequência é a concatenação dos campos, e um
 * separador comum pode aparecer DENTRO de um deles: com `|`, um produto
 * chamado `a|100` conseguiria imitar a fronteira entre dois campos e
 * fazer dois orçamentos diferentes darem o mesmo resumo — colidindo numa
 * linha só, que é pior do que duplicar.
 */
const SEPARADOR = '\u001f';

export function quoteFingerprint(quote: Quote, dealId: string | null): string {
  const partes: string[] = [
    dealId ?? '',
    quote.issuedOn,
    quote.orderNumber ?? '',
    quote.company,
    quote.customer.name,
    quote.customer.company ?? '',
    quote.customer.phone ?? '',
    quote.currency,
    // Duas casas: o documento imprime centavos, então é nessa precisão
    // que dois orçamentos são "o mesmo".
    quote.products.toFixed(2),
    // `null` e `0` são coisas diferentes — "não definido" e "por nossa
    // conta" — e o documento imprime uma e omite a outra.
    quote.shipping === null ? '' : quote.shipping.toFixed(2),
    quote.total.toFixed(2),
    quote.carrier ?? '',
    quote.owner ?? '',
    quote.notes ?? '',
    // As linhas na ORDEM em que saem no papel: trocar duas de lugar muda
    // o documento, então muda a impressão digital.
    ...quote.lines.flatMap((l) => [
      l.name,
      String(l.quantity),
      l.unitPrice.toFixed(2),
      String(l.discountPercent),
      l.total.toFixed(2),
    ]),
  ];

  return createHash('sha256').update(partes.join(SEPARADOR)).digest('hex');
}
