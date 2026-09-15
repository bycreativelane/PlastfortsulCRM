import { contactFiscalIssues, type FiscalFacts, type FiscalIssues } from '@/lib/contacts/fiscal';
import { sumCents, toCents } from '@/lib/money';

/**
 * AS REGRAS DO PEDIDO — §4 da especificação, Fase 3 do plano.
 *
 * Puras: recebem o que está na gaveta e dizem o que o pedido pesa, qual
 * categoria de receita ele leva, se as parcelas fecham e o que falta para
 * ir ao Bling. A gaveta desenha; a montagem do pedido (Fase 4) usa as
 * mesmas funções sobre o que está gravado — duas contas para a mesma
 * pergunta seriam a tela dizendo "pronto" e o envio recusando.
 */

// ------------------------------------------------------------------
// Peso
// ------------------------------------------------------------------

export interface WeightLine {
  productId: string | null;
  quantity: number;
  /** P produto · S serviço · N serviço de comunicação — só P pesa. */
  blingProductType?: string | null;
  unitGrossWeightKg?: number | null;
}

export interface OrderWeight {
  /** Em quilos, com três casas — a escala de `deals.gross_weight`. */
  totalKg: number;
  /** Índices das linhas de produto físico sem peso. */
  missing: number[];
}

/** A linha é de um produto que pesa? */
export function isPhysicalLine(linha: WeightLine): boolean {
  if (linha.blingProductType) return linha.blingProductType === 'P';
  // Sem tipo: produto do catálogo conta como físico (a PlastfortSul vende
  // lona e saco); texto livre ("montagem", "frete") não pesa.
  return linha.productId !== null;
}

function escala(valor: number | null | undefined, casas: number): bigint {
  const n = valor ?? 0;
  return BigInt(Number.isFinite(n) ? Math.round(n * 10 ** casas) : 0);
}

/**
 * O peso bruto do pedido: Σ quantidade × peso unitário, em gramas inteiros.
 *
 * Quantidade em milésimos × peso em gramas dá gramas × 1000; a divisão
 * arredonda meio para longe do zero, como o `ROUND` do Postgres. Somar em
 * float faria 3 × 0,105 kg dar 0,31499999999999995.
 */
export function orderWeight(linhas: WeightLine[]): OrderWeight {
  let gramas = BigInt(0);
  const missing: number[] = [];
  linhas.forEach((linha, i) => {
    if (!isPhysicalLine(linha)) return;
    if (linha.unitGrossWeightKg === null || linha.unitGrossWeightKg === undefined) {
      missing.push(i);
      return;
    }
    const produto = escala(linha.quantity, 3) * escala(linha.unitGrossWeightKg, 3);
    gramas += (produto * BigInt(2) + BigInt(1000)) / BigInt(2000);
  });
  return { totalKg: Number(gramas) / 1000, missing };
}

// ------------------------------------------------------------------
// Categoria de receita (D7)
// ------------------------------------------------------------------

export interface CategoryLine {
  productId: string | null;
  revenueCategoryBlingId?: string | null;
  /** `false` é item auxiliar (abraçadeira): não decide a categoria. */
  definesOrderCategory?: boolean | null;
}

export type OrderCategory =
  | { status: 'resolved'; categoryId: string; via: 'single' | 'auxiliary' }
  | { status: 'chosen'; categoryId: string; options: string[] }
  | { status: 'ambiguous'; options: string[] }
  | { status: 'missing'; lines: number[] }
  | { status: 'empty' };

/**
 * A categoria do pedido pela regra do misto.
 *
 * 1. As linhas PRINCIPAIS (produto que decide a categoria) mandam. Uma delas
 *    sem categoria deixa o pedido sem categoria — escolher pelas outras
 *    esconderia um produto sem mapeamento.
 * 2. Uma categoria só entre as principais: é ela.
 * 3. Mais de uma: a pessoa escolhe entre elas (`chosen`), e a escolha só
 *    vale se ainda estiver entre as opções — tirar o produto que a trazia
 *    derruba a escolha.
 * 4. Nenhuma principal, só auxiliares: as auxiliares decidem pelo mesmo
 *    critério. Um pedido só de abraçadeiras ainda é uma venda.
 *
 * Texto livre não entra na conta: não tem produto de onde herdar.
 */
export function orderCategory(linhas: CategoryLine[], escolhida: string | null): OrderCategory {
  const comProduto = linhas
    .map((linha, i) => ({ linha, i }))
    .filter(({ linha }) => linha.productId !== null);
  if (comProduto.length === 0) return { status: 'empty' };

  const principais = comProduto.filter(({ linha }) => linha.definesOrderCategory !== false);
  const grupo = principais.length > 0 ? principais : comProduto;

  const semCategoria = grupo.filter(({ linha }) => !linha.revenueCategoryBlingId).map(({ i }) => i);
  if (semCategoria.length > 0) return { status: 'missing', lines: semCategoria };

  const opcoes = [...new Set(grupo.map(({ linha }) => linha.revenueCategoryBlingId as string))];
  if (opcoes.length === 1) {
    return {
      status: 'resolved',
      categoryId: opcoes[0],
      via: principais.length > 0 ? 'single' : 'auxiliary',
    };
  }
  if (escolhida && opcoes.includes(escolhida)) {
    return { status: 'chosen', categoryId: escolhida, options: opcoes };
  }
  return { status: 'ambiguous', options: opcoes };
}

/** A categoria que vai ao Bling, quando há uma. */
export function categoryIdOf(resultado: OrderCategory): string | null {
  return resultado.status === 'resolved' || resultado.status === 'chosen'
    ? resultado.categoryId
    : null;
}

// ------------------------------------------------------------------
// Parcelas
// ------------------------------------------------------------------

export interface InstallmentLine {
  amount: number;
  dueOn: string | null;
  paymentMethodBlingId?: string | null;
}

export interface InstallmentsCheck {
  sumCents: number;
  /** soma − total; zero quando fecha. */
  diffCents: number;
  missingDue: number[];
  missingMethod: number[];
  /** Forma que não está entre as confirmadas pelo admin (destino compatível). */
  methodNotAllowed: number[];
}

export function checkInstallments(
  parcelas: InstallmentLine[],
  totalCents: number,
  formasPermitidas: ReadonlySet<string> | null
): InstallmentsCheck {
  const soma = sumCents(parcelas.map((p) => toCents(p.amount)));
  const missingDue: number[] = [];
  const missingMethod: number[] = [];
  const methodNotAllowed: number[] = [];
  parcelas.forEach((p, i) => {
    if (!p.dueOn) missingDue.push(i);
    if (!p.paymentMethodBlingId) missingMethod.push(i);
    else if (formasPermitidas && !formasPermitidas.has(p.paymentMethodBlingId)) {
      methodNotAllowed.push(i);
    }
  });
  return { sumCents: soma, diffCents: soma - totalCents, missingDue, missingMethod, methodNotAllowed };
}

// ------------------------------------------------------------------
// "Pronto para o Bling"
// ------------------------------------------------------------------

export type ReadinessKey =
  | 'customer'
  | 'products'
  | 'weight'
  | 'category'
  | 'payment'
  | 'installments'
  | 'carrier';

export interface ReadinessItem {
  key: ReadinessKey;
  ok: boolean;
  /** O campo da gaveta que resolve — o id do elemento para levar o foco. */
  field: string;
}

export interface ReadinessLine extends WeightLine, CategoryLine {
  blingProductId?: string | null;
}

export interface ReadinessCarrier {
  id: string;
  active: boolean;
  is_customer_pickup: boolean;
  bling_contact_id: string | null;
}

/**
 * O produto como está AGORA no catálogo — o que a linha congelou dele tem de
 * bater, ou a linha foi montada com um produto que mudou (ou foi forjada:
 * o snapshot é escrito pelo navegador).
 */
export interface ProductFacts {
  blingProductId: string | null;
  blingProductType: string | null;
  /** A categoria que o produto resolve hoje (produto → família → padrão). */
  revenueCategoryBlingId: string | null;
  definesOrderCategory: boolean;
}

/** O snapshot da linha ainda é o do produto? */
export function snapshotMatches(linha: ReadinessLine, produto: ProductFacts): boolean {
  return (
    (linha.blingProductId ?? null) === produto.blingProductId &&
    (linha.blingProductType ?? null) === produto.blingProductType &&
    (linha.revenueCategoryBlingId ?? null) === produto.revenueCategoryBlingId &&
    (linha.definesOrderCategory !== false) === produto.definesOrderCategory
  );
}

export interface ReadinessInput {
  contact: FiscalFacts | null;
  lines: ReadinessLine[];
  /** Produtos do catálogo ativos, por id — linha de produto fora dele está inativa. */
  activeProductIds: ReadonlySet<string> | null;
  /**
   * Os produtos ativos como estão agora, por id. Com ele, a linha cujo
   * snapshot não bate com o produto conta como sem vínculo (`staleLines`).
   */
  currentProducts?: ReadonlyMap<string, ProductFacts> | null;
  weightExceptionNote: string | null;
  chosenCategoryId: string | null;
  installments: InstallmentLine[];
  totalCents: number;
  allowedPaymentMethods: ReadonlySet<string> | null;
  carrier: ReadinessCarrier | null;
}

export interface Readiness {
  items: ReadinessItem[];
  ready: boolean;
  customer: FiscalIssues;
  weight: OrderWeight;
  category: OrderCategory;
  installments: InstallmentsCheck;
  /** Índices das linhas sem vínculo com o Bling, ou de produto inativo. */
  unlinkedLines: number[];
  /** Entre as sem vínculo: as de produto ativo que mudou depois de entrar na linha. */
  staleLines: number[];
  /** Por que a transportadora não serve, quando não serve. */
  carrierIssue: 'missing' | 'inactive' | 'not_linked' | null;
}

/**
 * A lista "Pronto para o Bling" — cada item diz o que falta e onde.
 *
 * Nada aqui fala com o Bling: é a leitura do que está na gaveta. O envio
 * (Fase 4) confere de novo contra o banco, porque a lista pode ter ficado
 * verde numa tela aberta há uma hora.
 */
export function orderReadiness(input: ReadinessInput): Readiness {
  const customer = contactFiscalIssues(input.contact);
  const weight = orderWeight(input.lines);
  const category = orderCategory(input.lines, input.chosenCategoryId);
  const installments = checkInstallments(
    input.installments,
    input.totalCents,
    input.allowedPaymentMethods
  );

  // D6: com a integração ligada, produto sem vínculo não entra em pedido — e
  // texto livre também não, porque o Bling não tem de onde tirar o item.
  const produtos = input.currentProducts ?? null;
  const staleLines = produtos
    ? input.lines
        .map((linha, i) => ({ linha, i }))
        .filter(({ linha }) => {
          if (linha.productId === null) return false;
          const produto = produtos.get(linha.productId);
          return produto !== undefined && !snapshotMatches(linha, produto);
        })
        .map(({ i }) => i)
    : [];
  const unlinkedLines = input.lines
    .map((linha, i) => ({ linha, i }))
    .filter(
      ({ linha, i }) =>
        !linha.blingProductId ||
        linha.productId === null ||
        (input.activeProductIds !== null && !input.activeProductIds.has(linha.productId)) ||
        (produtos !== null && !produtos.has(linha.productId)) ||
        staleLines.includes(i)
    )
    .map(({ i }) => i);

  const carrierIssue: Readiness['carrierIssue'] =
    input.carrier === null
      ? 'missing'
      : !input.carrier.active
        ? 'inactive'
        : input.carrier.is_customer_pickup || input.carrier.bling_contact_id
          ? null
          : 'not_linked';
  const carrierOk = carrierIssue === null;

  const items: ReadinessItem[] = [
    {
      key: 'customer',
      ok:
        input.contact !== null &&
        customer.document === null &&
        customer.address.length === 0 &&
        !customer.stateRegistration,
      field: 'deal-contact',
    },
    {
      key: 'products',
      ok: input.lines.length > 0 && unlinkedLines.length === 0,
      field: 'deal-items',
    },
    {
      key: 'weight',
      ok: weight.missing.length === 0 || !!input.weightExceptionNote?.trim(),
      field: 'deal-weight-exception',
    },
    {
      key: 'category',
      ok: category.status === 'resolved' || category.status === 'chosen',
      // Sem linha de produto a área da categoria nem aparece: o que resolve
      // é adicionar o produto.
      field: category.status === 'empty' ? 'deal-items' : 'deal-category',
    },
    {
      key: 'payment',
      ok:
        input.installments.length > 0 &&
        installments.missingMethod.length === 0 &&
        installments.methodNotAllowed.length === 0,
      field: 'deal-terms',
    },
    {
      key: 'installments',
      ok:
        input.installments.length > 0 &&
        installments.diffCents === 0 &&
        installments.missingDue.length === 0,
      field: 'deal-terms',
    },
    { key: 'carrier', ok: carrierOk, field: 'deal-carrier' },
  ];

  return {
    items,
    ready: items.every((item) => item.ok),
    customer,
    weight,
    category,
    installments,
    unlinkedLines,
    staleLines,
    carrierIssue,
  };
}
