import { createHash } from 'node:crypto';

import { addDays, fromISO, toISO } from '@/lib/calendar';
import { freightCode } from '@/lib/deals/freight';
import { categoryIdOf, orderCategory } from '@/lib/deals/order-rules';
import { fromCents, lineTotalCents, sumCents, toCents } from '@/lib/money';
import { discountUnit, orderTotals } from '@/lib/deals/totals';

/**
 * O PEDIDO DE VENDA COMO O BLING O RECEBE — puro, a partir do que está
 * GRAVADO (Fase 4).
 *
 * ------------------------------------------------------------------
 * DO BANCO, NUNCA DA TELA
 * ------------------------------------------------------------------
 *
 * Quem chama lê a oportunidade, as linhas e as parcelas do banco e passa
 * aqui. Um pedido montado do que o navegador mandou poderia dizer o que o
 * CRM não gravou — o mesmo defeito que `lib/quotes/from-deal.ts` fechou
 * para o documento.
 *
 * ------------------------------------------------------------------
 * O CONTRATO (OpenAPI v3, conferido em 15/09/2026)
 * ------------------------------------------------------------------
 *
 * - `itens[].valor` é o preço unitário e `itens[].desconto` é PERCENTUAL.
 *   Não há `valorLista` no esquema — o preço de lista fica no CRM.
 * - `itens[].id` e `parcelas[].id` aparecem como obrigatórios mas são
 *   "ignorados no POST": nenhum id do CRM vai como id de item ou parcela.
 * - `situacao` só na criação (Em aberto). O PUT vai sem ela: mudar situação
 *   é outra chamada, com outro efeito (Fase 5).
 * - `loja` e unidade de negócio ficam de fora: a PlastfortSul não usa loja.
 * - `numeroLoja` é a chave do CRM (`CRM-ORC-…`): é por ela que uma
 *   repetição depois de timeout acha o pedido em vez de criar outro.
 * - `dataPrevista` sem prazo informado: a data do pedido (D12).
 *
 * O resumo (`hash`) é do payload inteiro, com as chaves em ordem: é a chave
 * de idempotência da atualização — mandar duas vezes o mesmo pedido é uma
 * operação só.
 */

export const EXTERNAL_KEY_PREFIX = 'CRM-ORC-';

/** A chave do pedido no Bling (`numeroLoja`), estável por oportunidade. */
export function externalKey(dealId: string): string {
  return `${EXTERNAL_KEY_PREFIX}${dealId.replace(/-/g, '').slice(0, 16).toUpperCase()}`;
}

export interface OrderSourceDeal {
  id: string;
  sale_date?: string | null;
  departure_date?: string | null;
  expected_date?: string | null;
  delivery_days?: number | string | null;
  notes?: string | null;
  internal_notes?: string | null;
  shipping_cost?: number | string | null;
  other_expenses?: number | string | null;
  general_discount?: number | string | null;
  general_discount_unit?: string | null;
  freight_mode?: string | null;
  freight_volumes?: number | string | null;
  gross_weight?: number | string | null;
  revenue_category_bling_id?: string | null;
  bling_external_key?: string | null;
}

export interface OrderSourceItem {
  product_id: string | null;
  name: string;
  sku?: string | null;
  unit?: string | null;
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  bling_product_id?: string | null;
  revenue_category_bling_id?: string | null;
  defines_order_category?: boolean | null;
  bling_product_type?: string | null;
  unit_gross_weight_kg?: number | string | null;
}

export interface OrderSourceInstallment {
  due_on: string | null;
  amount: number | string;
  note?: string | null;
  payment_method_bling_id?: string | null;
}

export interface OrderSourceCarrier {
  id?: string;
  active?: boolean;
  name: string;
  bling_contact_id: string | null;
  bling_contact_name: string | null;
  default_freight_payer_code: string | null;
  is_customer_pickup: boolean;
}

export interface OrderSource {
  deal: OrderSourceDeal;
  items: OrderSourceItem[];
  installments: OrderSourceInstallment[];
  contactBlingId: string | null;
  carrier: OrderSourceCarrier | null;
  sellerBlingId: string | null;
  /** `bling_settings.status_open_id` — só a criação usa. */
  statusOpenId: string | null;
  /** `YYYY-MM-DD` no fuso da conta: a data do pedido quando `sale_date` é vazio. */
  today: string;
}

export type PayloadProblem =
  | 'no_contact'
  | 'no_items'
  | 'item_not_linked'
  | 'no_category'
  | 'no_installments'
  | 'installment_without_method'
  | 'installment_without_due'
  | 'installments_mismatch'
  | 'no_open_status'
  | 'invalid_id';

export type BuildResult =
  | { ok: true; payload: Record<string, unknown>; hash: string; totalCents: number }
  | { ok: false; problems: PayloadProblem[] };

const numero = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/** Os ids do Bling são inteiros na API; guardados como texto no CRM. */
function idBling(valor: string | null | undefined): number | null {
  if (!valor || !/^\d{1,19}$/.test(valor)) return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) ? n : null;
}

const dinheiro = (v: number | string | null | undefined) => fromCents(toCents(v ?? 0));
const texto = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t ? t : undefined;
};

/** JSON com as chaves em ordem — o mesmo pedido dá o mesmo resumo. */
export function stableJson(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(stableJson).join(',')}]`;
  if (valor && typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

/**
 * Os totais do pedido gravado — `lib/deals/totals.ts` sobre as linhas em
 * centavos. A mesma conta para o payload e para a lista "Pronto para o Bling"
 * do servidor.
 */
export function sourceTotals(deal: OrderSourceDeal, itens: OrderSourceItem[]) {
  const linhas = itens.filter((i) => i.name.trim() && Number(i.quantity) > 0);
  return orderTotals({
    productsCents: sumCents(
      linhas.map((l) =>
        lineTotalCents({
          quantity: Number(l.quantity),
          unitPrice: Number(l.unit_price),
          discountPercent: Number(l.discount_percent),
        })
      )
    ),
    otherExpenses: numero(deal.other_expenses),
    shipping: numero(deal.shipping_cost),
    generalDiscount: numero(deal.general_discount),
    generalDiscountUnit: discountUnit(deal.general_discount_unit),
  });
}

export function buildOrderPayload(src: OrderSource, modo: 'create' | 'update'): BuildResult {
  const problemas = new Set<PayloadProblem>();
  const { deal } = src;

  const contato = idBling(src.contactBlingId);
  if (!contato) problemas.add('no_contact');

  const linhas = src.items.filter((i) => i.name.trim() && Number(i.quantity) > 0);
  if (linhas.length === 0) problemas.add('no_items');

  const itens = linhas.map((item) => {
    const produto = idBling(item.bling_product_id);
    if (!produto) problemas.add('item_not_linked');
    return {
      codigo: texto(item.sku),
      unidade: texto(item.unit),
      quantidade: Number(item.quantity),
      desconto: Number(item.discount_percent) || 0,
      valor: dinheiro(item.unit_price),
      descricao: item.name.trim(),
      produto: produto ? { id: produto } : undefined,
    };
  });

  const categoria = categoryIdOf(
    orderCategory(
      linhas.map((l) => ({
        productId: l.product_id,
        revenueCategoryBlingId: l.revenue_category_bling_id ?? null,
        definesOrderCategory: l.defines_order_category,
      })),
      deal.revenue_category_bling_id ?? null
    )
  );
  const categoriaId = idBling(categoria);
  if (!categoriaId) problemas.add('no_category');

  // O total do pedido pela fórmula do Bling, em centavos — as parcelas têm
  // de fechar com ele, ou o Bling recusa (ou, pior, aceita e diverge).
  const unidadeDesconto = discountUnit(deal.general_discount_unit);
  const totais = sourceTotals(deal, linhas);

  if (src.installments.length === 0) problemas.add('no_installments');
  const parcelas = src.installments.map((p) => {
    const forma = idBling(p.payment_method_bling_id);
    if (!forma) problemas.add('installment_without_method');
    if (!p.due_on) problemas.add('installment_without_due');
    return {
      dataVencimento: p.due_on ?? undefined,
      valor: dinheiro(p.amount),
      observacoes: texto(p.note),
      formaPagamento: forma ? { id: forma } : undefined,
    };
  });
  const somaParcelas = sumCents(src.installments.map((p) => toCents(p.amount)));
  if (src.installments.length > 0 && somaParcelas !== totais.totalCents) {
    problemas.add('installments_mismatch');
  }

  const situacaoAberta = idBling(src.statusOpenId);
  if (modo === 'create' && !situacaoAberta) problemas.add('no_open_status');

  if (problemas.size > 0) return { ok: false, problems: [...problemas] };

  const dataPedido = deal.sale_date || src.today;
  const prazo = numero(deal.delivery_days);
  const baseDoPrazo = fromISO(deal.departure_date || dataPedido);
  const dataPrevista =
    deal.expected_date ||
    (prazo !== null && baseDoPrazo ? toISO(addDays(baseDoPrazo, prazo)) : dataPedido);

  const codigoFrete = freightCode(deal.freight_mode) ?? src.carrier?.default_freight_payer_code ?? null;
  const transportador = idBling(src.carrier?.bling_contact_id);
  const volumes = numero(deal.freight_volumes);
  const peso = numero(deal.gross_weight);
  const frete = numero(deal.shipping_cost);

  const payload: Record<string, unknown> = {
    numeroLoja: deal.bling_external_key || externalKey(deal.id),
    data: dataPedido,
    dataSaida: deal.departure_date || undefined,
    dataPrevista,
    contato: { id: contato },
    situacao: modo === 'create' ? { id: situacaoAberta } : undefined,
    itens,
    parcelas,
    categoria: { id: categoriaId },
    observacoes: texto(deal.notes),
    observacoesInternas: texto(deal.internal_notes),
    outrasDespesas: totais.otherExpensesCents > 0 ? fromCents(totais.otherExpensesCents) : undefined,
    desconto:
      totais.discountCents > 0
        ? { valor: dinheiro(deal.general_discount), unidade: unidadeDesconto }
        : undefined,
    transporte: {
      fretePorConta: codigoFrete !== null ? Number(codigoFrete) : undefined,
      frete: frete !== null ? dinheiro(frete) : undefined,
      quantidadeVolumes: volumes !== null ? Math.round(volumes) : undefined,
      pesoBruto: peso !== null ? Math.round(peso * 1000) / 1000 : undefined,
      prazoEntrega: prazo !== null ? Math.round(prazo) : undefined,
      contato: transportador
        ? { id: transportador, nome: src.carrier?.bling_contact_name || src.carrier?.name }
        : undefined,
    },
    vendedor: idBling(src.sellerBlingId) ? { id: idBling(src.sellerBlingId) } : undefined,
  };

  const limpo = JSON.parse(stableJson(payload)) as Record<string, unknown>;
  return {
    ok: true,
    payload: limpo,
    hash: createHash('sha256').update(stableJson(limpo)).digest('hex'),
    totalCents: totais.totalCents,
  };
}

/**
 * O que conferir depois de gravar: o Bling devolveu o que mandamos?
 *
 * Três coisas que, divergindo, tornam o pedido do Bling OUTRO pedido: o
 * total, a quantidade de itens e o cliente. O resto (observação, peso) o
 * Bling pode normalizar sem que isso seja divergência.
 */
export function compareRemoteOrder(
  remoto: Record<string, unknown> | null,
  esperado: { totalCents: number; itemCount: number; contactId: number }
): string[] {
  if (!remoto) return ['missing'];
  const diferencas: string[] = [];
  const total = typeof remoto.total === 'number' ? toCents(remoto.total) : null;
  if (total !== null && total !== esperado.totalCents) diferencas.push('total');
  const itens = Array.isArray(remoto.itens) ? remoto.itens.length : null;
  if (itens !== null && itens !== esperado.itemCount) diferencas.push('items');
  const contato = (remoto.contato as { id?: unknown } | undefined)?.id;
  if (contato !== undefined && Number(contato) !== esperado.contactId) diferencas.push('contact');
  return diferencas;
}
