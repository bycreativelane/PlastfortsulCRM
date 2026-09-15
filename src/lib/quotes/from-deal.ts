import type { SupabaseClient } from '@supabase/supabase-js';

import { freightCode } from '@/lib/deals/freight';
import { loadInstallments, type Installment } from '@/lib/deals/installments';
import { loadDealItems, type DealItem } from '@/lib/products/catalog';

import type { QuoteInput } from './quote';

/**
 * O ORÇAMENTO A PARTIR DO QUE ESTÁ GRAVADO — e não do que o navegador manda.
 *
 * ------------------------------------------------------------------
 * O DEFEITO QUE ISTO FECHA
 * ------------------------------------------------------------------
 *
 * `POST /api/quotes` recebia as linhas, as parcelas, o frete e o cliente no
 * corpo da requisição e refazia a conta em cima deles. A conta era do
 * servidor, mas os INSUMOS eram do navegador — e o documento arquivado
 * podia dizer uma coisa que o banco não dizia:
 *
 *   - uma linha sem nome ou com quantidade zero entrava no documento e não
 *     era gravada (`buildQuote` desenha tudo; `dealItemRows` filtra);
 *   - o que estava na tela e ainda não tinha sido salvo ia para o arquivo
 *     como se fosse o pedido;
 *   - um orçamento podia sair de uma oportunidade que nunca foi salva.
 *
 * Um arquivo que o cliente recebeu e que não bate com o pedido gravado é o
 * defeito que um ERP cobra: o PUT no Bling é montado do banco, e o PDF que
 * saiu antes dele diria outra coisa.
 *
 * Agora a gaveta SALVA antes de gerar e manda só o id; a rota lê a
 * oportunidade, o contato, as linhas, as parcelas e o responsável sob a
 * RLS de quem pediu, e o documento é o pedido gravado.
 *
 * ------------------------------------------------------------------
 * O QUE CONTINUA VINDO DO NAVEGADOR
 * ------------------------------------------------------------------
 *
 * Só tradução: os rótulos do documento e o nome de cada código de frete por
 * conta. Nenhum número, nenhuma linha, nenhum nome de cliente.
 */

interface LinhaDeal {
  id: string;
  account_id: string;
  contact_id: string | null;
  assigned_to: string | null;
  sales_order_number: string | null;
  value: number | string | null;
  currency: string | null;
  shipping_cost: number | string | null;
  carrier: string | null;
  notes: string | null;
  payment_terms?: string | null;
  freight_mode?: string | null;
  freight_volumes?: number | string | null;
  gross_weight?: number | string | null;
  other_expenses?: number | string | null;
  general_discount?: number | string | null;
  general_discount_unit?: string | null;
  /** 085. `internal_notes` também vem no `*` e NUNCA é lido aqui. */
  valid_until?: string | null;
  delivery_days?: number | string | null;
  bling_order_number?: string | null;
}

interface LinhaContato {
  name: string | null;
  phone: string | null;
  company: string | null;
}

/** NUMERIC chega como número ou texto; ausência continua ausência. */
const numero = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/**
 * O mapeamento, puro — o que o carregador lê vira o `QuoteInput`.
 *
 * Separado do carregamento para ser testado sem banco: é aqui que "o
 * documento é o pedido gravado" deixa de ser uma intenção.
 */
export function quoteInputFromRows(args: {
  deal: LinhaDeal;
  contact: LinhaContato | null;
  items: DealItem[];
  installments: Installment[];
  ownerName: string | null;
  issuedOn: string;
  company: string | null;
  /** Código do frete por conta → rótulo traduzido. */
  freightModeLabels: Record<string, string>;
}): QuoteInput {
  const { deal } = args;
  const codigoFrete = freightCode(deal.freight_mode);

  return {
    // Depois do envio, o número do Bling é o oficial (§7, risco 12): o PDF
    // que sai com o pedido registrado leva o número que o Bling devolveu.
    orderNumber: deal.bling_order_number || deal.sales_order_number,
    issuedOn: args.issuedOn,
    company: args.company,
    customerName: args.contact?.name || args.contact?.phone || null,
    customerCompany: args.contact?.company ?? null,
    customerPhone: args.contact?.phone ?? null,
    items: args.items.map((linha) => ({
      productId: linha.product_id,
      name: linha.name,
      sku: linha.sku ?? null,
      unit: linha.unit ?? null,
      quantity: Number(linha.quantity),
      unitPrice: Number(linha.unit_price),
      discountPercent: Number(linha.discount_percent),
    })),
    value: numero(deal.value),
    currency: deal.currency || 'BRL',
    shipping: numero(deal.shipping_cost),
    otherExpenses: numero(deal.other_expenses),
    generalDiscount: numero(deal.general_discount),
    generalDiscountUnit: deal.general_discount_unit ?? null,
    paymentTerms: deal.payment_terms ?? null,
    installments: args.installments.map((p) => ({
      days: Number(p.days),
      dueOn: p.due_on,
      amount: Number(p.amount),
      method: p.method,
      note: p.note,
    })),
    carrier: deal.carrier,
    freightMode: codigoFrete ? (args.freightModeLabels[codigoFrete] ?? null) : null,
    freightVolumes: numero(deal.freight_volumes),
    grossWeight: numero(deal.gross_weight),
    owner: args.ownerName,
    notes: deal.notes,
    validUntil: deal.valid_until ?? null,
    deliveryDays: numero(deal.delivery_days),
  };
}

/**
 * Lê o pedido gravado, sob a RLS de quem chamou. `null` quando a
 * oportunidade não existe ou não é desta conta.
 */
export async function loadQuoteInputFromDeal(
  db: SupabaseClient,
  args: {
    accountId: string;
    dealId: string;
    issuedOn: string;
    company: string | null;
    freightModeLabels: Record<string, string>;
  }
): Promise<QuoteInput | null> {
  const { data: deal } = await db
    .from('deals')
    .select('*')
    .eq('id', args.dealId)
    .eq('account_id', args.accountId)
    .maybeSingle();
  if (!deal) return null;
  const linha = deal as LinhaDeal;

  const [contato, itens, parcelas, dono] = await Promise.all([
    linha.contact_id
      ? db
          .from('contacts')
          .select('name, phone, company')
          .eq('id', linha.contact_id)
          .maybeSingle()
          .then(({ data }) => (data as LinhaContato | null) ?? null)
      : Promise.resolve(null),
    loadDealItems(db, args.dealId),
    loadInstallments(db, args.dealId),
    // `deals.assigned_to` aponta para `profiles.id`, e não para o id de
    // auth — a exceção registrada em `estado-do-projeto.md`.
    linha.assigned_to
      ? db
          .from('profiles')
          .select('full_name')
          .eq('id', linha.assigned_to)
          .maybeSingle()
          .then(
            ({ data }) =>
              (data as { full_name: string | null } | null)?.full_name ?? null
          )
      : Promise.resolve(null),
  ]);

  return quoteInputFromRows({
    deal: linha,
    contact: contato,
    items: itens === 'missing-table' ? [] : itens,
    installments: parcelas === 'missing-table' ? [] : parcelas,
    ownerName: dono,
    issuedOn: args.issuedOn,
    company: args.company,
    freightModeLabels: args.freightModeLabels,
  });
}
