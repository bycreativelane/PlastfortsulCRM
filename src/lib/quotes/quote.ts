import type { DealItemDraft } from '@/lib/products/catalog';
import type { InstallmentDraft } from '@/lib/deals/installments';
import { fromCents, lineTotalCents, sumCents, toCents } from '@/lib/money';
import {
  discountUnit,
  orderTotals,
  type DiscountUnit,
} from '@/lib/deals/totals';

/**
 * O orçamento, como dado.
 *
 * ------------------------------------------------------------------
 * UMA CONTA SÓ, E É POR ISSO QUE ESTE ARQUIVO EXISTE
 * ------------------------------------------------------------------
 *
 * O item 55 do pacote termina com uma frase que decide a arquitetura:
 * "Imagem e PDF devem utilizar os mesmos dados. Não manter dois cálculos
 * independentes."
 *
 * Então a soma acontece aqui, uma vez, longe de qualquer pixel. O que
 * desenha — a prévia na tela, a versão de impressão, e qualquer formato
 * que venha depois — recebe números prontos e não tem permissão para
 * somar nada. Um documento que diz um total e uma tela que diz outro é o
 * defeito mais caro que um orçamento pode ter, porque quem descobre é o
 * cliente.
 *
 * E a multiplicação vem de `lib/money.ts` em vez de ser reescrita: ela é a
 * cópia em TypeScript da coluna `total` GENERATED da 054, feita em
 * centavos inteiros — a mesma que `lineTotal` do catálogo usa. Uma
 * terceira versão da mesma conta seria a mesma dívida com outro nome.
 *
 * TODA SOMA DESTE ARQUIVO É EM CENTAVOS. Somar reais em float e arredondar
 * no fim é o que fazia o documento imprimir R$ 0,52 numa linha que o banco
 * grava como R$ 0,53 (ver `lib/money.ts`).
 *
 * ------------------------------------------------------------------
 * O QUE ESTE CRM AINDA NÃO SABE DIZER
 * ------------------------------------------------------------------
 *
 * O item 54 pede, no cabeçalho, "logo PlastfortSul […] dados essenciais da
 * empresa", e no rodapé "contato da PlastfortSul; site". Nada disso existe
 * neste banco: `accounts` tem nome, dono, fuso, moeda e horário comercial,
 * e `whatsapp_config` guarda o `phone_number_id` da Meta — um id, não um
 * telefone que se imprima.
 *
 * O documento é montado com o que existe e não inventa o que não existe.
 * Está registrado no plano como a única parte do item 54 que depende de
 * uma coluna que ninguém escreveu ainda.
 */

export interface QuoteLine {
  name: string;
  /** Código e unidade, como o Bling imprime ao lado da descrição. */
  sku: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  /** Já calculado. Quem desenha não multiplica. */
  total: number;
}

/**
 * Uma parcela, como o documento a imprime.
 *
 * Espelha `InstallmentDraft` de propósito, em vez de reusá-la: o que chega
 * aqui já passou por `buildQuote`, e o documento não sabe o que é rascunho
 * de formulário. É a mesma fronteira que `QuoteLine` guarda em relação a
 * `DealItemDraft`.
 */
export interface QuoteInstallment {
  days: number;
  dueOn: string | null;
  amount: number;
  method: string | null;
  note: string | null;
}

/**
 * O desconto geral, como o documento o imprime.
 *
 * O valor digitado E o valor em reais que ele deu. Em PERCENTUAL os dois
 * são diferentes, e o arquivo congela os dois: recalcular "10 %" depois
 * sobre uma soma de itens que mudou daria outro número do que o cliente
 * recebeu.
 */
export interface QuoteDiscount {
  value: number;
  unit: DiscountUnit;
  /** Em reais, já convertido da unidade. */
  amount: number;
}

export interface Quote {
  /** O número do Bling, quando já foi digitado (item 39). */
  orderNumber: string | null;
  /** `YYYY-MM-DD`, no fuso de quem gerou. */
  issuedOn: string;
  company: string;
  customer: {
    name: string;
    company: string | null;
    phone: string | null;
  };
  lines: QuoteLine[];
  currency: string;
  /** Soma das linhas — ou o valor digitado, quando não há linhas. */
  products: number;
  /**
   * Outras despesas do pedido (078). `null` e zero são omitidos no papel:
   * diferente do frete, "outras despesas R$ 0,00" não comunica decisão
   * nenhuma.
   */
  otherExpenses: number | null;
  /** `null` é "não definido", que o documento omite em vez de imprimir 0. */
  shipping: number | null;
  /** O desconto geral (078). `null` quando não há — zero não se imprime. */
  discount: QuoteDiscount | null;
  /**
   * `products + outras despesas + frete − desconto geral` — a fórmula do
   * pedido de venda, feita em `lib/deals/totals.ts`. A única soma do
   * documento.
   */
  total: number;
  /**
   * CONDIÇÃO DE PAGAMENTO — o atalho e as parcelas que ele descreve.
   *
   * As duas coisas viajam juntas porque o documento imprime as duas: a
   * condição em uma linha ("30/60/90") e as parcelas embaixo, com data e
   * valor. Ver o cabeçalho de `lib/deals/installments.ts` para por que
   * elas são linhas guardadas e não um cálculo refeito na hora.
   */
  paymentTerms: string | null;
  installments: QuoteInstallment[];
  carrier: string | null;
  /** O "frete por conta" do Bling, já como texto legível. */
  freightMode: string | null;
  /** Volumes e peso bruto — o que a transportadora pergunta. */
  freightVolumes: number | null;
  grossWeight: number | null;
  owner: string | null;
  notes: string | null;
}

export interface QuoteInput {
  orderNumber?: string | null;
  issuedOn: string;
  company?: string | null;
  customerName?: string | null;
  customerCompany?: string | null;
  customerPhone?: string | null;
  items: DealItemDraft[];
  /** O valor digitado, usado só quando não há linhas (item 46). */
  value?: number | null;
  currency: string;
  shipping?: number | null;
  otherExpenses?: number | null;
  generalDiscount?: number | null;
  generalDiscountUnit?: string | null;
  paymentTerms?: string | null;
  installments?: InstallmentDraft[];
  carrier?: string | null;
  freightMode?: string | null;
  freightVolumes?: number | null;
  grossWeight?: number | null;
  owner?: string | null;
  notes?: string | null;
}

/** Texto que não é texto vira ausência, e o documento omite ausências. */
function limpo(valor: string | null | undefined): string | null {
  const t = (valor ?? '').trim();
  return t === '' ? null : t;
}

/**
 * Número que não é número vira ausência — e ZERO não é ausência.
 *
 * Peso bruto e volumes começam vazios e assim ficam num orçamento que sai
 * antes de alguém pesar nada; o documento omite o que não sabe. Mas
 * `0` digitado é uma resposta, e imprimir "0 kg" é diferente de não
 * imprimir linha nenhuma — por isso o teste é contra `null`/`NaN`, e não
 * contra falsidade.
 */
function numero(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Monta o orçamento a partir da oportunidade.
 *
 * O VALOR DIGITADO SÓ VALE SEM LINHAS, que é a regra do item 46 — "calcular
 * automaticamente a partir dos itens quando houver quantidade e valor
 * unitário; permitir ajuste manual apenas se necessário". Com linhas, o
 * número que alguém digitou antes de montar a lista é um número velho.
 */
export function buildQuote(input: QuoteInput): Quote {
  const centavosPorLinha = input.items.map((item) => lineTotalCents(item));

  const lines: QuoteLine[] = input.items.map((item, i) => ({
    name: item.name.trim(),
    sku: limpo(item.sku),
    unit: limpo(item.unit),
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discountPercent: item.discountPercent,
    total: fromCents(centavosPorLinha[i]),
  }));

  const produtosCentavos = lines.length
    ? sumCents(centavosPorLinha)
    : toCents(input.value ?? 0);

  const shipping =
    input.shipping === null || input.shipping === undefined
      ? null
      : input.shipping;

  const unidade = discountUnit(input.generalDiscountUnit);
  const totais = orderTotals({
    productsCents: produtosCentavos,
    otherExpenses: input.otherExpenses ?? null,
    shipping,
    generalDiscount: input.generalDiscount ?? null,
    generalDiscountUnit: unidade,
  });

  return {
    orderNumber: limpo(input.orderNumber),
    issuedOn: input.issuedOn,
    company: limpo(input.company) ?? '',
    customer: {
      name: limpo(input.customerName) ?? '',
      company: limpo(input.customerCompany),
      phone: limpo(input.customerPhone),
    },
    lines,
    currency: input.currency,
    products: fromCents(produtosCentavos),
    otherExpenses:
      totais.otherExpensesCents > 0 ? fromCents(totais.otherExpensesCents) : null,
    shipping,
    discount:
      totais.discountCents > 0
        ? {
            value: input.generalDiscount ?? 0,
            unit: unidade,
            amount: fromCents(totais.discountCents),
          }
        : null,
    total: fromCents(totais.totalCents),
    paymentTerms: limpo(input.paymentTerms),
    // As parcelas VAZIAS não entram: uma linha sem valor e sem data é o
    // formulário no meio de uma edição, não uma condição de pagamento.
    installments: (input.installments ?? [])
      .filter((p) => p.amount > 0 || p.dueOn)
      .map((p) => ({
        days: p.days,
        dueOn: p.dueOn,
        amount: p.amount,
        method: limpo(p.method),
        note: limpo(p.note),
      })),
    carrier: limpo(input.carrier),
    freightMode: limpo(input.freightMode),
    freightVolumes: numero(input.freightVolumes),
    grossWeight: numero(input.grossWeight),
    owner: limpo(input.owner),
    notes: limpo(input.notes),
  };
}

/**
 * O nome do arquivo que a pessoa vai salvar.
 *
 * Com o número do pedido quando há um, porque é assim que a operação
 * chama o documento — "manda o 14349". Sem ele, a data e o cliente, que
 * é o suficiente para não haver dois `orcamento.pdf` na mesma pasta.
 */
export function quoteFileName(quote: Quote): string {
  const pedaco = quote.orderNumber
    ? quote.orderNumber
    : `${quote.issuedOn}-${quote.customer.name || 'cliente'}`;
  const limpado = pedaco
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `orcamento-${limpado || 'sem-numero'}`;
}
