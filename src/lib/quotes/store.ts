import type { SupabaseClient } from '@supabase/supabase-js';

import { discountUnit } from '@/lib/deals/totals';

import type { Quote, QuoteInstallment, QuoteLine } from './quote';

/**
 * Onde um orçamento gerado fica guardado.
 *
 * O documento, e não o PDF — o arquivo nasce no navegador de quem clicou
 * "Salvar como PDF" e o servidor nunca vê aqueles bytes. O argumento
 * inteiro está no topo da migração 071; em uma frase: guardar os dados
 * deixa a página redesenhar pelo MESMO componente e pelo MESMO cálculo,
 * enquanto um PDF guardado seria uma segunda verdade sobre o total.
 */

export interface StoredQuote extends Quote {
  id: string;
  dealId: string | null;
  createdAt: string;
  /** O arquivo, quando a geração do servidor chegou a produzi-lo. */
  pdfUrl: string | null;
  imageUrl: string | null;
}

/** Um banco sem a 071. Mesma convenção de `products/catalog`. */
export type QuotesResult = StoredQuote[] | 'missing-table';

const AUSENTE = ['42P01', 'PGRST205', 'PGRST202'];

function tabelaAusente(error: { code?: string; message?: string }): boolean {
  if (error.code && AUSENTE.includes(error.code)) return true;
  return (
    /deal_quotes/.test(error.message ?? '') &&
    /(does not exist|not find|schema cache)/i.test(error.message ?? '')
  );
}

interface Linha {
  id: string;
  deal_id: string | null;
  order_number: string | null;
  issued_on: string;
  company: string;
  customer_name: string;
  customer_company: string | null;
  customer_phone: string | null;
  lines: QuoteLine[] | null;
  currency: string;
  products: number | string;
  shipping: number | string | null;
  total: number | string;
  payment_terms?: string | null;
  installments?: QuoteInstallment[] | null;
  carrier: string | null;
  freight_mode?: string | null;
  freight_volumes?: number | string | null;
  gross_weight?: number | string | null;
  other_expenses?: number | string | null;
  general_discount?: number | string | null;
  general_discount_unit?: string | null;
  discount_amount?: number | string | null;
  owner: string | null;
  notes: string | null;
  valid_until?: string | null;
  delivery_days?: number | string | null;
  created_at: string;
  pdf_url: string | null;
  image_url: string | null;
}

/**
 * NUMERIC pode voltar como número ou como texto, e isto aceita os dois.
 *
 * Medido contra o banco em 8 de setembro: os três vieram como NÚMERO.
 * Esta função foi escrita esperando texto — `NUMERIC(14,2)` não cabe em
 * `double` sem perda no caso geral, e há versões e configurações do
 * PostgREST que entregam string por isso.
 *
 * A guarda fica, e o comentário deixa de afirmar o que não acontece. Ela
 * custa uma comparação e cobre a diferença entre um total que aparece e
 * um `"605.00"` cru — com ponto e sem símbolo — no lugar de um valor.
 */
const numero = (v: number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : Number(v);

/** O mesmo, para colunas em que ausência não é zero. */
const opcional = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : numero(v);

function daLinha(row: Linha): StoredQuote {
  return {
    id: row.id,
    dealId: row.deal_id,
    createdAt: row.created_at,
    pdfUrl: row.pdf_url ?? null,
    imageUrl: row.image_url ?? null,
    orderNumber: row.order_number,
    issuedOn: row.issued_on,
    company: row.company,
    customer: {
      name: row.customer_name,
      company: row.customer_company,
      phone: row.customer_phone,
    },
    lines: Array.isArray(row.lines) ? row.lines : [],
    currency: row.currency,
    products: numero(row.products),
    shipping:
      row.shipping === null || row.shipping === undefined
        ? null
        : numero(row.shipping),
    total: numero(row.total),
    // Os campos da 076. `?? null` e não `numero()` nos dois medidos:
    // ausente e zero são coisas diferentes aqui — um orçamento sem peso
    // não pesa zero, ele não foi pesado, e o documento omite um e imprime
    // o outro. Num banco anterior à 076 a coluna nem vem, e o bloco de
    // transporte daquele orçamento fica como sempre esteve.
    paymentTerms: row.payment_terms ?? null,
    installments: Array.isArray(row.installments) ? row.installments : [],
    freightMode: row.freight_mode ?? null,
    freightVolumes: opcional(row.freight_volumes),
    grossWeight: opcional(row.gross_weight),
    // Os campos da 078. O desconto sai do que FOI IMPRESSO
    // (`discount_amount`), nunca recalculado: em PERCENTUAL, refazer a
    // conta sobre linhas congeladas até daria o mesmo número, mas o
    // documento reaberto tem de ser o documento enviado, não uma conta
    // nova que por acaso concorda com ele. Linha anterior à 078 não traz
    // as colunas e reabre como sempre abriu.
    otherExpenses:
      opcional(row.other_expenses) && numero(row.other_expenses) > 0
        ? numero(row.other_expenses)
        : null,
    discount:
      opcional(row.discount_amount) && numero(row.discount_amount) > 0
        ? {
            value: numero(row.general_discount),
            unit: discountUnit(row.general_discount_unit),
            amount: numero(row.discount_amount),
          }
        : null,
    carrier: row.carrier,
    owner: row.owner,
    notes: row.notes,
    // Validade e prazo (086). Linha anterior não traz as colunas.
    validUntil: row.valid_until ?? null,
    deliveryDays: opcional(row.delivery_days),
  };
}

/*
 * `saveQuote` SAIU DAQUI, e a ausência é o registro.
 *
 * Ela gravava a linha do lado do cliente, sem impressão digital — que é
 * exatamente o caminho pelo qual oito cliques viraram oito orçamentos
 * idênticos no print do Gabriel. Quem arquiva agora é `POST /api/quotes`,
 * que refaz os totais, procura pela impressão digital da 074 e só então
 * insere.
 *
 * Ninguém a chamava mais. Uma segunda porta para gravar a mesma linha,
 * sem a guarda que a primeira tem, é a duplicata esperando ser
 * reintroduzida por quem a encontrasse exportada e pronta.
 */

/** Os orçamentos da conta, do mais novo para o mais velho. */
export async function loadQuotes(
  db: SupabaseClient,
  accountId: string,
  limit = 200
): Promise<QuotesResult> {
  const { data, error } = await db
    .from('deal_quotes')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (tabelaAusente(error)) return 'missing-table';
    console.error('[orçamentos] não carregou:', error.message);
    return [];
  }
  return ((data ?? []) as Linha[]).map(daLinha);
}

/**
 * Procura por cliente, número do pedido ou o que está numa linha.
 *
 * No cliente e não no banco, pelo mesmo motivo do playbook: são dezenas
 * ou centenas de documentos, já estão todos carregados, e a busca
 * instantânea vale mais do que uma ida ao servidor por tecla. Se um dia
 * forem milhares, o sintoma é o primeiro carregamento e a correção é
 * paginar — não é hoje.
 */
export function matchesQuote(quote: StoredQuote, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const campos = [
    quote.orderNumber,
    quote.customer.name,
    quote.customer.company,
    quote.company,
    quote.carrier,
    quote.owner,
    ...quote.lines.map((l) => l.name),
  ];
  return campos.some((c) => (c ?? '').toLowerCase().includes(q));
}
