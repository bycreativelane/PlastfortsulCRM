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
    // O bloco de transporte e o de pagamento IMPRIMEM, então entram — pela
    // regra do topo, "tudo que o documento imprime, e nada além". Sem
    // eles, trocar a condição de 30/60/90 para à vista devolveria o PDF
    // antigo: mesmo total, mesma impressão digital, documento errado.
    quote.freightMode ?? '',
    quote.freightVolumes === null ? '' : String(quote.freightVolumes),
    quote.grossWeight === null ? '' : String(quote.grossWeight),
    quote.paymentTerms ?? '',
    quote.owner ?? '',
    quote.notes ?? '',
    ...quote.installments.flatMap((p) => [
      String(p.days),
      p.dueOn ?? '',
      p.amount.toFixed(2),
      p.method ?? '',
      p.note ?? '',
    ]),
    // As linhas na ORDEM em que saem no papel: trocar duas de lugar muda
    // o documento, então muda a impressão digital.
    ...quote.lines.flatMap((l) => [
      l.name,
      l.sku ?? '',
      l.unit ?? '',
      String(l.quantity),
      l.unitPrice.toFixed(2),
      String(l.discountPercent),
      l.total.toFixed(2),
    ]),
    /*
     * OUTRAS DESPESAS E DESCONTO GERAL (078) — imprimem, então entram.
     *
     * SÓ QUANDO EXISTEM, e atrás de um marcador. Acrescentar dois campos
     * vazios ao fim de todo orçamento mudaria a impressão digital de TODOS
     * os que já estão no arquivo: no dia do deploy, o mesmo orçamento
     * gerado de novo viraria uma linha nova em vez de reaproveitar a
     * antiga. Sem despesa e sem desconto a sequência fica idêntica à de
     * antes; com eles, o marcador impede que esses valores se confundam
     * com uma linha de produto.
     */
    ...(quote.otherExpenses !== null || quote.discount !== null
      ? [
          '078',
          quote.otherExpenses === null ? '' : quote.otherExpenses.toFixed(2),
          quote.discount === null
            ? ''
            : `${quote.discount.value}${SEPARADOR}${quote.discount.unit}${SEPARADOR}${quote.discount.amount.toFixed(2)}`,
        ]
      : []),
    // VALIDADE E PRAZO DE ENTREGA (085) — pela mesma regra e com o mesmo
    // cuidado: só quando existem, atrás de um marcador, para não mudar a
    // impressão digital dos orçamentos que já estão no arquivo.
    ...(quote.validUntil !== null || quote.deliveryDays !== null
      ? [
          '085',
          quote.validUntil ?? '',
          quote.deliveryDays === null ? '' : String(quote.deliveryDays),
        ]
      : []),
  ];

  return createHash('sha256').update(partes.join(SEPARADOR)).digest('hex');
}
