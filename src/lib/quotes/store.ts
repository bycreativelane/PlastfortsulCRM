import type { SupabaseClient } from '@supabase/supabase-js';

import type { Quote, QuoteLine } from './quote';

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
  carrier: string | null;
  owner: string | null;
  notes: string | null;
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
    carrier: row.carrier,
    owner: row.owner,
    notes: row.notes,
  };
}

/**
 * Guarda o orçamento que acabou de ser gerado.
 *
 * Não devolve erro para a tela por decisão: quem apertou o botão queria
 * IMPRIMIR, e a impressão já aconteceu. Falhar em arquivar não pode virar
 * um alarme vermelho em cima de uma ação que deu certo — vai para o
 * console, que é onde se procura quando a lista aparecer curta.
 */
export async function saveQuote(
  db: SupabaseClient,
  args: { accountId: string; dealId: string | null; userId: string | null },
  quote: Quote
): Promise<{ error: string | null }> {
  const { error } = await db.from('deal_quotes').insert({
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
  });
  if (error) {
    console.error('[orçamentos] não arquivou:', error.message);
    return { error: error.message };
  }
  return { error: null };
}

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
