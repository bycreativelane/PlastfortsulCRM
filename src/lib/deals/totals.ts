import { percentOfCents, toCents } from '@/lib/money';

/**
 * O TOTAL DO PEDIDO — a conta do pedido de venda do Bling, num lugar só.
 *
 * ------------------------------------------------------------------
 * A FÓRMULA
 * ------------------------------------------------------------------
 *
 *     total = Σ itens + outras despesas + frete − desconto geral
 *
 * É a do Bling, e o pedido de exemplo da especificação a confere no
 * centavo: itens R$ 1.040,00 + frete R$ 80,00 − desconto R$ 3,00 =
 * R$ 1.117,00.
 *
 * Até a 078 a oportunidade só somava itens e frete. O documento imprimia
 * "Produtos + Frete = Total", e as parcelas dividiam esse número — um
 * pedido com desconto geral no Bling saía daqui com um total que não era
 * o dele.
 *
 * O DESCONTO DE ITEM NÃO ENTRA AQUI. Ele já está no total de cada linha
 * (054), e subtraí-lo de novo seria cobrar o desconto duas vezes do lado
 * de quem vende — a especificação escreve isso com todas as letras.
 *
 * ------------------------------------------------------------------
 * O DESCONTO EM PERCENTUAL
 * ------------------------------------------------------------------
 *
 * A base é a soma dos itens, e não o total com frete. É a leitura mais
 * comum de ERP — frete e despesas são repasse, não mercadoria —, mas a
 * documentação do Bling não diz, e por isso está marcada no plano para
 * confirmar na homologação antes de um pedido sair com ela.
 *
 * Tudo em centavos (`lib/money.ts`).
 */

export type DiscountUnit = 'REAL' | 'PERCENTUAL';

/** O que estiver gravado vira uma unidade válida; o padrão é REAL. */
export function discountUnit(valor: string | null | undefined): DiscountUnit {
  return valor === 'PERCENTUAL' ? 'PERCENTUAL' : 'REAL';
}

export interface OrderTotalsInput {
  /** A soma das linhas — ou o valor digitado, quando não há linhas. */
  productsCents: number;
  otherExpenses: number | null;
  shipping: number | null;
  generalDiscount: number | null;
  generalDiscountUnit: DiscountUnit;
}

export interface OrderTotals {
  productsCents: number;
  otherExpensesCents: number;
  shippingCents: number;
  /** O desconto geral em centavos, já convertido da unidade. */
  discountCents: number;
  /** Antes do desconto geral — o teto do que se pode descontar. */
  grossCents: number;
  totalCents: number;
}

export function orderTotals(input: OrderTotalsInput): OrderTotals {
  const otherExpensesCents = toCents(input.otherExpenses ?? 0);
  const shippingCents = toCents(input.shipping ?? 0);
  const valor = input.generalDiscount ?? 0;
  const discountCents =
    valor <= 0
      ? 0
      : input.generalDiscountUnit === 'PERCENTUAL'
        ? percentOfCents(input.productsCents, valor)
        : toCents(valor);
  const grossCents = input.productsCents + otherExpensesCents + shippingCents;

  return {
    productsCents: input.productsCents,
    otherExpensesCents,
    shippingCents,
    discountCents,
    grossCents,
    totalCents: grossCents - discountCents,
  };
}

/**
 * Um desconto maior que o pedido.
 *
 * Não é arredondado para caber, de propósito: um total negativo é erro de
 * digitação — R$ 300 onde se queria 3 —, e engolir o erro mandaria ao
 * cliente um orçamento de R$ 0,00 sem ninguém ter decidido isso. A gaveta
 * mostra o problema e não grava.
 */
export function discountExceedsOrder(totais: OrderTotals): boolean {
  return totais.discountCents > totais.grossCents;
}

/**
 * O FRETE CONTADO DUAS VEZES.
 *
 * A 054 permitiu uma linha de texto livre porque "frete e montagem estão
 * em metade dos orçamentos e em nenhum catálogo" — e isso era verdade
 * antes de a 070 criar o campo de frete. Com os dois, quem já tinha o
 * hábito de pôr "Frete" como produto e agora também preenche o campo
 * cobra o frete duas vezes: uma nos itens, outra no total. No Bling o
 * frete é um campo do transporte, e uma linha "Frete" viraria item de
 * venda com categoria de produto.
 *
 * Só linha LIVRE (sem produto do catálogo) cujo nome COMEÇA com "frete":
 * "Frete", "FRETE Braspress". Um produto de catálogo com "frete" no nome
 * é decisão de cadastro, e não este engano.
 *
 * Aviso, e não bloqueio: pode existir o caso legítimo (um frete de retorno
 * cobrado à parte), e quem sabe é quem está montando o pedido.
 */
export function shippingCountedTwice(
  itens: Array<{ productId: string | null; name: string }>,
  shipping: number | null
): boolean {
  if ((shipping ?? 0) <= 0) return false;
  return itens.some((item) => !item.productId && /^\s*frete\b/i.test(item.name));
}
