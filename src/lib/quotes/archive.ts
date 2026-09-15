import type { Quote } from './quote';

/**
 * A linha de `deal_quotes`, em camadas — uma por migração que pode faltar.
 *
 * ------------------------------------------------------------------
 * POR QUE CAMADAS
 * ------------------------------------------------------------------
 *
 * As migrações deste projeto são aplicadas à mão, e entre escrever uma e
 * rodá-la existe uma janela em que as colunas dela não estão no banco. Um
 * insert que cite UMA coluna inexistente é recusado INTEIRO pelo PostgREST
 * (`PGRST204`) — não grava as outras.
 *
 * A primeira versão deste recuo tinha duas camadas, e a segunda ainda
 * citava `fingerprint`, que é da 074. Medido em 14 de setembro de 2026 com
 * a 074, a 075 e a 076 por aplicar: as duas tentativas morriam iguais, e
 * NENHUM orçamento podia ser gerado. Por isso as camadas agora saem daqui,
 * de uma função pura, e `src/lib/supabase/unapplied-columns.test.ts` lê as
 * migrações para conferir que cada uma só cita o que a dela já criou.
 *
 * ------------------------------------------------------------------
 * A ORDEM É DA MAIS NOVA PARA A MAIS VELHA
 * ------------------------------------------------------------------
 *
 * Quem grava tenta a primeira e só desce quando o erro é de coluna
 * inexistente. Cada camada tira EXATAMENTE o que a migração seguinte
 * acrescentou, e nada além — tirar a mais seria perder em silêncio um
 * campo que o banco saberia guardar.
 *
 * Sem a 074 não há deduplicação (o índice único é o que a garante), e isso
 * é voltar ao comportamento de antes dela, não um defeito novo.
 */
export interface ArchiveLayer {
  /** A migração mais nova de que esta camada depende. */
  migration: number;
  row: Record<string, unknown>;
}

export function archiveLayers(args: {
  accountId: string;
  dealId: string | null;
  userId: string | null;
  quote: Quote;
  fingerprint: string;
}): ArchiveLayer[] {
  const { quote } = args;

  const da071 = {
    account_id: args.accountId,
    deal_id: args.dealId,
    user_id: args.userId,
    order_number: quote.orderNumber,
    issued_on: quote.issuedOn,
    company: quote.company,
    customer_name: quote.customer.name,
    customer_company: quote.customer.company,
    customer_phone: quote.customer.phone,
    lines: quote.lines,
    currency: quote.currency,
    products: quote.products,
    shipping: quote.shipping,
    total: quote.total,
    carrier: quote.carrier,
    owner: quote.owner,
    notes: quote.notes,
  };

  const da074 = { ...da071, fingerprint: args.fingerprint };

  const da076 = {
    ...da074,
    payment_terms: quote.paymentTerms,
    installments: quote.installments,
    freight_mode: quote.freightMode,
    freight_volumes: quote.freightVolumes,
    gross_weight: quote.grossWeight,
  };

  // Outras despesas e desconto geral. `discount_amount` é o valor em reais
  // que saiu no papel — ver `QuoteDiscount`.
  const da078 = {
    ...da076,
    other_expenses: quote.otherExpenses,
    general_discount: quote.discount?.value ?? null,
    general_discount_unit: quote.discount?.unit ?? null,
    discount_amount: quote.discount?.amount ?? null,
  };

  return [
    { migration: 78, row: da078 },
    { migration: 76, row: da076 },
    { migration: 74, row: da074 },
    { migration: 71, row: da071 },
  ];
}
