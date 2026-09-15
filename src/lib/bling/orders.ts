import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { loadAccountConnection, type AccountConnection } from './account-connection';
import { blingRequest, type ClientDeps } from './client';
import { BlingContactError, resolveBlingContact, type CrmContact } from './contacts';
import { BlingApiError, BlingConnectionError, BlingLeaseLostError } from './errors';
import { foldName, type BlingSettingsRow } from './health';
import { loadOrderContext } from '@/lib/deals/order-context';
import { orderReadiness, type ProductFacts } from '@/lib/deals/order-rules';
import { productFacts, type Product } from '@/lib/products/catalog';

import {
  buildOrderPayload,
  compareRemoteOrder,
  externalKey,
  sourceTotals,
  stableJson,
  type OrderSourceCarrier,
  type OrderSourceDeal,
  type OrderSourceInstallment,
  type OrderSourceItem,
} from './order-payload';

/**
 * CRIAR E ATUALIZAR O PEDIDO NO BLING — Fase 4, a parte que conversa.
 *
 * ------------------------------------------------------------------
 * CRIAR NUNCA DUPLICA
 * ------------------------------------------------------------------
 *
 * O POST do Bling não é idempotente. Então, TODA VEZ antes de criar,
 * consulta `GET /pedidos/vendas?numerosLojas[]=CRM-ORC-…`: achou, liga;
 * não achou, cria. Um timeout, um 5xx ou uma conexão que caiu depois do
 * POST não viram "falhou": viram `uncertain`, e a próxima tentativa começa
 * pela mesma consulta. É o "clique duplo e timeout não duplicam" dos
 * critérios de aceite.
 *
 * ------------------------------------------------------------------
 * ATUALIZAR SÓ EM ABERTO
 * ------------------------------------------------------------------
 *
 * GET do remoto, confere que ele está Em aberto e que nada foi lançado
 * (localmente: `*_launched_at`), PUT completo sem `situacao`, GET de novo e
 * compara. Alteração depois de lançamento está fora do MVP (§9).
 *
 * Toda leitura é do BANCO, com o service role: o pedido que vai ao Bling é o
 * pedido gravado.
 */

export interface LoadedOrder {
  deal: OrderSourceDeal & {
    account_id: string;
    contact_id: string | null;
    assigned_to: string | null;
    carrier_id?: string | null;
    order_status?: string | null;
    bling_order_id?: string | null;
    bling_order_number?: string | null;
    bling_source_hash?: string | null;
    sync_status?: string | null;
    sync_version?: number | null;
    accounts_launched_at?: string | null;
    stock_launched_at?: string | null;
    weight_exception_note?: string | null;
    weight_exception_by?: string | null;
    pipeline_id?: string | null;
    created_at?: string | null;
  };
  items: OrderSourceItem[];
  installments: OrderSourceInstallment[];
  contact: CrmContact | null;
  carrier: OrderSourceCarrier | null;
  sellerBlingId: string | null;
  settings: (Partial<BlingSettingsRow> & {
    company_id: string;
    orders_enabled?: boolean | null;
    status_open_id: string | null;
    payment_method_ids?: string[] | null;
  }) | null;
  connection: AccountConnection | null;
  clientTypeId: string | null;
  /**
   * Os produtos ATIVOS das linhas como estão agora, com a categoria que
   * resolvem hoje. O snapshot da linha é escrito pelo navegador; o servidor
   * confere contra isto antes de mandar (auditoria da 0.11.0).
   */
  products: Map<string, ProductFacts>;
  /** A exceção de peso foi autorizada por quem é admin da conta? */
  weightExceptionByAdmin: boolean;
}

const PAPEIS_QUE_AUTORIZAM = new Set(['owner', 'admin']);

export async function loadOrderForBling(
  db: SupabaseClient,
  accountId: string,
  dealId: string
): Promise<LoadedOrder | null> {
  const { data: deal } = await db
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!deal) return null;
  const d = deal as LoadedOrder['deal'];

  // Toda leitura filha leva a conta: o service role passa por cima da RLS, e
  // um id de outra conta gravado na oportunidade não pode trazer o cadastro
  // de lá para dentro do pedido (a 090 também recusa gravar isso).
  const [itens, parcelas, contato, transportadora, ajustes, conexao, dono, tipos, autorizou] = await Promise.all([
    db.from('deal_items').select('*').eq('deal_id', dealId).eq('account_id', accountId).order('position', { ascending: true }),
    db.from('deal_installments').select('*').eq('deal_id', dealId).eq('account_id', accountId).order('position', { ascending: true }),
    d.contact_id
      ? db.from('contacts').select('*').eq('id', d.contact_id).eq('account_id', accountId).maybeSingle()
      : Promise.resolve({ data: null }),
    d.carrier_id
      ? db.from('carriers').select('*').eq('id', d.carrier_id).eq('account_id', accountId).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('bling_settings').select('*').eq('account_id', accountId).maybeSingle(),
    loadAccountConnection(db, accountId).catch(() => ({ state: 'none' as const })),
    // `deals.assigned_to` aponta para `profiles.id`; o vínculo de vendedor é
    // por usuário de auth (085).
    d.assigned_to
      ? db.from('profiles').select('user_id').eq('id', d.assigned_to).eq('account_id', accountId).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('bling_references').select('bling_id, label').eq('account_id', accountId).eq('kind', 'contact_type').is('removed_at', null),
    d.weight_exception_note?.trim() && d.weight_exception_by
      ? db
          .from('profiles')
          .select('account_role')
          .eq('user_id', d.weight_exception_by)
          .eq('account_id', accountId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const settings = (ajustes.data ?? null) as LoadedOrder['settings'];
  const connection = conexao.state === 'ok' ? conexao.connection : null;
  const linhas = (itens.data ?? []) as OrderSourceItem[];
  const products = await currentProductFacts(db, accountId, linhas);

  let sellerBlingId: string | null = null;
  const userId = (dono.data as { user_id?: string } | null)?.user_id;
  if (userId && connection) {
    const { data: vinculo } = await db
      .from('bling_seller_links')
      .select('bling_seller_id, company_id')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .maybeSingle();
    const v = vinculo as { bling_seller_id: string; company_id: string } | null;
    if (v && v.company_id === connection.company_id) sellerBlingId = v.bling_seller_id;
  }

  const cliente = ((tipos.data ?? []) as Array<{ bling_id: string; label: string }>).find(
    (t) => foldName(t.label) === 'cliente'
  );

  return {
    deal: d,
    items: linhas,
    installments: (parcelas.data ?? []) as OrderSourceInstallment[],
    contact: (contato.data ?? null) as CrmContact | null,
    carrier: (transportadora.data ?? null) as OrderSourceCarrier | null,
    sellerBlingId,
    settings,
    connection,
    clientTypeId: cliente?.bling_id ?? null,
    products,
    weightExceptionByAdmin: PAPEIS_QUE_AUTORIZAM.has(
      String((autorizou.data as { account_role?: string } | null)?.account_role ?? '')
    ),
  };
}

/**
 * Os produtos ativos das linhas, da conta, com a categoria que resolvem hoje
 * — pela mesma função que a gaveta usa ao congelar a linha
 * (`lib/deals/order-context.ts`).
 */
async function currentProductFacts(
  db: SupabaseClient,
  accountId: string,
  linhas: OrderSourceItem[]
): Promise<Map<string, ProductFacts>> {
  const ids = [...new Set(linhas.map((l) => l.product_id).filter((id): id is string => !!id))];
  const mapa = new Map<string, ProductFacts>();
  if (ids.length === 0) return mapa;
  const [{ data, error }, contexto] = await Promise.all([
    db
      .from('products')
      .select('id, active, bling_product_id, bling_product_type, bling_family_id, revenue_category_bling_id, defines_order_category')
      .eq('account_id', accountId)
      .eq('active', true)
      .in('id', ids),
    loadOrderContext(db, accountId),
  ]);
  // Uma leitura que falhou não é "produto inativo" nem "categoria mudou":
  // quem chama repete (a fila trata o estouro como passageiro) em vez de
  // falhar o pedido com "item sem vínculo".
  if (error) throw new Error(`[bling] não consegui ler os produtos do pedido: ${error.message}`);
  if (!contexto.categoriesComplete) {
    throw new Error('[bling] não consegui ler os ajustes, os cadastros ou o mapa de famílias do pedido');
  }
  for (const produto of (data ?? []) as Array<Product & { id: string }>) {
    mapa.set(produto.id, productFacts(produto, contexto.resolveCategory));
  }
  return mapa;
}

/** Os campos do contato que vão ao Bling (`contactToBling`) — o resto não muda o pedido. */
const CAMPOS_DO_CONTATO = [
  'id', 'name', 'phone', 'email', 'company', 'tax_id', 'city', 'state', 'person_type', 'trade_name',
  'state_registration', 'taxpayer_indicator', 'rg', 'zip_code', 'street', 'street_number', 'complement',
  'district', 'nfe_email', 'landline_phone',
] as const;

/** Os campos da transportadora que o pedido usa. */
const CAMPOS_DA_TRANSPORTADORA = [
  'id', 'name', 'bling_contact_id', 'bling_contact_name', 'default_freight_payer_code', 'is_customer_pickup',
] as const;

/**
 * O resumo do pedido GRAVADO — a chave de idempotência da atualização, e o
 * que `deals.bling_source_hash` guarda do que o Bling recebeu (090).
 *
 * Do que está no banco e não do payload: o payload precisa do id do cliente
 * no Bling, que pode ainda não existir na hora de enfileirar. Por isso o
 * vínculo do contato (`bling_contact_id`, gravado durante a própria criação)
 * fica fora, e só entram os campos que vão ao Bling: uma mensagem nova do
 * cliente, que mexe em outras colunas do contato, não pode "dessincronizar"
 * o pedido.
 */
export function orderSourceHash(o: LoadedOrder): string {
  const d = o.deal as unknown as Record<string, unknown>;
  const campos = [
    'sale_date', 'departure_date', 'expected_date', 'delivery_days', 'notes', 'internal_notes',
    'shipping_cost', 'other_expenses', 'general_discount', 'general_discount_unit', 'freight_mode',
    'freight_volumes', 'gross_weight', 'revenue_category_bling_id', 'carrier_id', 'contact_id', 'assigned_to',
  ];
  const escolher = (linha: object | null, chaves: readonly string[]) =>
    linha ? Object.fromEntries(chaves.map((c) => [c, (linha as Record<string, unknown>)[c] ?? null])) : null;
  const resumo = {
    deal: Object.fromEntries(campos.map((c) => [c, d[c] ?? null])),
    items: o.items.map((i) => [i.name, i.sku ?? null, i.unit ?? null, String(i.quantity), String(i.unit_price), String(i.discount_percent), i.bling_product_id ?? null, i.revenue_category_bling_id ?? null, i.defines_order_category ?? null]),
    installments: o.installments.map((p) => [p.due_on, String(p.amount), p.note ?? null, p.payment_method_bling_id ?? null]),
    contact: escolher(o.contact, CAMPOS_DO_CONTATO),
    carrier: escolher(o.carrier, CAMPOS_DA_TRANSPORTADORA),
    seller: o.sellerBlingId,
  };
  return createHash('sha256').update(stableJson(resumo)).digest('hex');
}

/**
 * O pedido do CRM é o que o Bling recebeu por último? Pelo resumo gravado na
 * última criação ou atualização aceita (090). É o que libera lançar contas a
 * partir do pedido do Bling.
 */
export function orderMatchesBling(o: LoadedOrder): boolean {
  return !!o.deal.bling_source_hash && o.deal.bling_source_hash === orderSourceHash(o);
}

/** Sincronizado e sem nada mudado desde então — a conferência da rota. */
export function orderIsSynced(o: LoadedOrder): boolean {
  return (o.deal.sync_status === 'synced' || o.deal.sync_status === 'pending') && orderMatchesBling(o);
}

/**
 * A lista "Pronto para o Bling" sobre o pedido GRAVADO — a mesma regra da
 * gaveta (`lib/deals/order-rules.ts`), conferida de novo no servidor antes de
 * enfileirar: a lista da tela pode ter ficado verde numa aba aberta há uma
 * hora.
 *
 * Duas conferências que só o servidor faz: o snapshot de cada linha contra o
 * produto como está agora (o navegador escreve o snapshot), e a exceção de
 * peso só vale quando quem autorizou é admin da conta.
 */
export function readinessOfLoaded(p: LoadedOrder) {
  const numeroOuNulo = (v: number | string | null | undefined) =>
    v === null || v === undefined || v === '' ? null : Number(v);
  const formas = p.settings?.payment_method_ids ?? [];
  return orderReadiness({
    contact: p.contact,
    lines: p.items.map((i) => ({
      productId: i.product_id,
      quantity: Number(i.quantity),
      blingProductId: i.bling_product_id ?? null,
      blingProductType: i.bling_product_type ?? null,
      unitGrossWeightKg: numeroOuNulo(i.unit_gross_weight_kg),
      revenueCategoryBlingId: i.revenue_category_bling_id ?? null,
      definesOrderCategory: i.defines_order_category,
    })),
    activeProductIds: new Set(p.products.keys()),
    currentProducts: p.products,
    weightExceptionNote: p.weightExceptionByAdmin ? (p.deal.weight_exception_note ?? null) : null,
    chosenCategoryId: p.deal.revenue_category_bling_id ?? null,
    installments: p.installments.map((x) => ({
      amount: Number(x.amount),
      dueOn: x.due_on,
      paymentMethodBlingId: x.payment_method_bling_id ?? null,
    })),
    totalCents: sourceTotals(p.deal, p.items).totalCents,
    allowedPaymentMethods: formas.length ? new Set(formas) : null,
    carrier: p.carrier?.id
      ? {
          id: p.carrier.id,
          active: p.carrier.active !== false,
          is_customer_pickup: p.carrier.is_customer_pickup,
          bling_contact_id: p.carrier.bling_contact_id,
        }
      : null,
  });
}

/** Os produtos ativos da conta entre estes ids. */
export async function activeProductIds(
  db: SupabaseClient,
  accountId: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await db
    .from('products')
    .select('id')
    .eq('account_id', accountId)
    .eq('active', true)
    .in('id', ids);
  return new Set(((data ?? []) as Array<{ id: string }>).map((p) => p.id));
}

/** Uma linha de `deal_order_events` (088), sem conta, oportunidade e autor. */
export interface OrderEvent {
  kind: string;
  from_status?: string | null;
  to_status?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * O desfecho de uma operação. `dealPatch` vai para a oportunidade também na
 * falha e na repetição: um lançamento que DEU CERTO antes de a operação cair
 * tem de ficar carimbado, ou a repetição lançaria de novo.
 */
export type OrderOutcome =
  | { status: 'succeeded'; result: Record<string, unknown>; dealPatch: Record<string, unknown>; events?: OrderEvent[] }
  | { status: 'failed'; error: string; dealPatch?: Record<string, unknown>; events?: OrderEvent[] }
  | {
      status: 'retry';
      error: string;
      uncertain: boolean;
      dealPatch?: Record<string, unknown>;
      events?: OrderEvent[];
      /**
       * O que vale para a oportunidade se esta for a ÚLTIMA tentativa: a
       * situação que já mudou no Bling, por exemplo (auditoria da 0.11.0).
       * Numa repetição ele não vai — a próxima tentativa precisa ver a
       * situação de antes para decidir o que lançar.
       */
      finalDealPatch?: Record<string, unknown>;
    };

interface PedidoRemoto {
  id?: number | string;
  numero?: number | string;
  numeroLoja?: string;
  total?: number;
  itens?: unknown[];
  contato?: { id?: number | string };
  situacao?: { id?: number | string };
}

/**
 * A mensagem que vai para `bling_operations.error` e `deals.sync_error`: a
 * descrição do Bling e o que ele disse de cada campo, já sanitizados em
 * `parseBlingError`, cortada no limite da coluna.
 */
export function textoDoErro(erro: BlingApiError): string {
  const campos = (erro.extra.fields ?? [])
    .map((f) => {
      // O que o Bling diz de um campo do cliente pode citar o próprio dado
      // ("CEP 90000-000 inválido", "IE 123… não confere"), e o sanitizador
      // não reconhece todo formato de RG, IE e endereço. A mensagem vai para
      // `sync_error`, que a gaveta mostra: fica só o nome do campo.
      if (f.element && ELEMENTO_DO_CLIENTE.test(f.element)) return `${f.element}: [omitido]`;
      return f.element ? `${f.element}: ${f.message}` : f.message;
    })
    .filter(Boolean);
  const texto = [`bling:${erro.status || 'sem-resposta'}:${erro.detail}`, ...campos].join(' · ');
  return texto.slice(0, 600);
}

/** Campos do Bling que carregam dado do cliente (contato, endereço, documento). */
const ELEMENTO_DO_CLIENTE =
  /(^|[.[\]])(contato|endereco|etiqueta)([.[\]]|$)|numeroDocumento|\b(ie|rg|cep|bairro|municipio|complemento|nome|fantasia|email|emailNotaFiscal|telefone|celular|fone)\b/i;

/** Um erro do Bling vira resultado: repetir, ou parar com a mensagem. */
function desfechoDoErro(erro: unknown, depoisDeEscrever: boolean): OrderOutcome {
  // Outro processo é o dono da operação: parar sem escrever. O término
  // deste não grava nada (compare-and-set), então o desfecho é só formal.
  if (erro instanceof BlingLeaseLostError) return { status: 'retry', error: 'lease_lost', uncertain: false };
  if (erro instanceof BlingContactError) return { status: 'failed', error: erro.code };
  if (erro instanceof BlingConnectionError) {
    const passageiro = erro.code === 'refresh_busy' || erro.code === 'refresh_throttled' || erro.code === 'limiter_unavailable';
    return passageiro
      ? { status: 'retry', error: erro.code, uncertain: depoisDeEscrever }
      : { status: 'failed', error: erro.code };
  }
  if (erro instanceof BlingApiError) {
    if (erro.isTransient) return { status: 'retry', error: textoDoErro(erro), uncertain: depoisDeEscrever };
    // 429 do dia: só amanhã. Não é falha do pedido.
    if (erro.isRateLimited) return { status: 'retry', error: 'daily_limit', uncertain: depoisDeEscrever };
    return { status: 'failed', error: textoDoErro(erro) };
  }
  return { status: 'retry', error: 'unexpected', uncertain: depoisDeEscrever };
}

/**
 * Cria ou atualiza. `today` é a data do pedido quando a venda não tem data
 * (`YYYY-MM-DD` no fuso da conta).
 */
export async function syncOrder(
  db: SupabaseClient,
  pedido: LoadedOrder,
  kind: 'create_order' | 'update_order',
  opcoes: { today: string; deps?: ClientDeps; now?: () => number }
): Promise<OrderOutcome> {
  const { deal, settings, connection } = pedido;
  const agora = new Date((opcoes.now ?? Date.now)()).toISOString();
  const deps = opcoes.deps ?? {};

  if (!settings?.orders_enabled) return { status: 'failed', error: 'orders_disabled' };
  if (!connection || connection.status === 'revoked') return { status: 'failed', error: 'not_connected' };
  if (settings.company_id !== connection.company_id) return { status: 'failed', error: 'company_mismatch' };
  if (kind === 'update_order' && !deal.bling_order_id) return { status: 'failed', error: 'order_not_created' };

  const chave = deal.bling_external_key || externalKey(deal.id);

  /*
   * ONDE O PEDIDO ESTÁ. Ligado: é aquele — inclusive numa criação que a
   * reconciliação ligou pela chave enquanto esperava a repetição. Sem vínculo,
   * procura pela chave ANTES de qualquer outra conferência: uma tentativa
   * anterior pode ter criado o pedido, e um pedido que existe no Bling é
   * ligado mesmo que o conteúdo de agora ainda não possa ir.
   *
   * Pedido que já existe recebe o conteúdo de AGORA (PUT). Ligar sem enviar
   * gravava como "o que o Bling recebeu" um pedido que ele nunca recebeu — e
   * Em andamento lançava as contas do conteúdo da tentativa antiga.
   */
  let remotoId: string | null = deal.bling_order_id ? String(deal.bling_order_id) : null;
  let achadoPelaChave = false;
  let numeroAchado: string | null = null;
  if (!remotoId) {
    try {
      const busca = await blingRequest<{ data?: PedidoRemoto[] }>(
        db,
        connection.id,
        '/pedidos/vendas',
        { query: { 'numerosLojas[]': chave, pagina: 1, limite: 5 } },
        deps
      );
      const achados = (busca?.data ?? []).filter((p) => !p.numeroLoja || p.numeroLoja === chave);
      if (achados.length > 1) {
        return {
          status: 'failed',
          error: 'duplicate_remote',
          dealPatch: { sync_status: 'divergent', sync_error: 'duplicate_remote' },
        };
      }
      if (achados.length === 1 && achados[0].id !== undefined && achados[0].id !== null) {
        remotoId = String(achados[0].id);
        achadoPelaChave = true;
        numeroAchado = achados[0].numero !== undefined && achados[0].numero !== null ? String(achados[0].numero) : null;
      }
    } catch (erro) {
      return desfechoDoErro(erro, false);
    }
  }

  /**
   * O pedido achado pela chave fica ligado em qualquer desfecho: a próxima
   * tentativa (ou o próximo "Atualizar") o atualiza em vez de procurar de novo.
   * Sem o resumo — o conteúdo não foi.
   */
  const comVinculo = (saida: OrderOutcome): OrderOutcome => {
    if (!achadoPelaChave || saida.status === 'succeeded') return saida;
    return {
      ...saida,
      dealPatch: {
        bling_order_id: remotoId,
        bling_external_key: chave,
        bling_order_number: numeroAchado,
        ...(deal.order_status ? {} : { order_status: 'em_aberto' }),
        ...(saida.dealPatch ?? {}),
      },
      events: [
        { kind: 'order_created', to_status: 'em_aberto', detail: { blingOrderId: remotoId, number: numeroAchado, linkedExisting: true, contentSent: false } },
        ...(saida.events ?? []),
      ],
    };
  };

  const atualizar = remotoId !== null;
  if (atualizar && (deal.accounts_launched_at || deal.stock_launched_at)) {
    return comVinculo({ status: 'failed', error: 'order_launched' });
  }
  // Compra futura destrava o pedido no CRM, mas o Bling só aceita PUT Em
  // aberto: atualizar aqui terminaria sempre "divergente".
  if (atualizar && deal.order_status && deal.order_status !== 'em_aberto') {
    return comVinculo({ status: 'failed', error: 'order_not_open' });
  }
  if (!pedido.contact) return comVinculo({ status: 'failed', error: 'contact_document_missing' });

  // O snapshot das linhas é escrito pelo navegador: conferido contra o
  // produto como está agora, e texto livre não vai (a rota conferiu a lista
  // inteira; isto fecha a janela entre a rota e esta operação).
  if (readinessOfLoaded(pedido).unlinkedLines.length > 0) {
    return comVinculo({ status: 'failed', error: 'payload:item_not_linked' });
  }

  // O pedido fecha? Conferido antes de encostar no cliente do Bling (com um
  // id de ensaio): um pedido que não sai não completa cadastro lá.
  const fonte = {
    deal: { ...deal, bling_external_key: chave },
    items: pedido.items,
    installments: pedido.installments,
    carrier: pedido.carrier,
    sellerBlingId: pedido.sellerBlingId,
    statusOpenId: settings.status_open_id,
    today: opcoes.today,
  };
  const ensaio = buildOrderPayload({ ...fonte, contactBlingId: '1' }, atualizar ? 'update' : 'create');
  if (!ensaio.ok) return comVinculo({ status: 'failed', error: `payload:${ensaio.problems.join(',')}` });

  let contato;
  try {
    contato = await resolveBlingContact(db, connection.id, pedido.contact, {
      clientTypeId: pedido.clientTypeId,
      accountId: deal.account_id,
      deps,
    });
  } catch (erro) {
    return comVinculo(desfechoDoErro(erro, false));
  }

  const montagem = buildOrderPayload({ ...fonte, contactBlingId: contato.blingId }, atualizar ? 'update' : 'create');
  if (!montagem.ok) return comVinculo({ status: 'failed', error: `payload:${montagem.problems.join(',')}` });

  const contactId = Number(contato.blingId);
  const itemCount = (montagem.payload.itens as unknown[]).length;
  let escreveu = false;
  let chaveNova = false;

  try {
    if (!atualizar) {
      if (!deal.bling_external_key) {
        // A chave vai para o banco ANTES do POST — é por ela que a próxima
        // tentativa acha o pedido — e só agora, com o pedido pronto para ir:
        // uma montagem recusada não deixa chave, e a oportunidade continua
        // podendo ser apagada.
        const { error } = await db
          .from('deals')
          .update({ bling_external_key: chave })
          .eq('id', deal.id)
          .eq('account_id', deal.account_id);
        if (error) return { status: 'retry', error: 'save_key_failed', uncertain: false };
        chaveNova = true;
      }
      escreveu = true;
      const criado = await blingRequest<{ data?: { id?: number | string } }>(
        db,
        connection.id,
        '/pedidos/vendas',
        { method: 'POST', body: montagem.payload },
        deps
      );
      if (criado?.data?.id === undefined || criado?.data?.id === null) {
        return { status: 'retry', error: 'no_id_returned', uncertain: true };
      }
      remotoId = String(criado.data.id);
    } else {
      const atual = await blingRequest<{ data?: PedidoRemoto }>(
        db,
        connection.id,
        `/pedidos/vendas/${encodeURIComponent(String(remotoId))}`,
        {},
        deps
      );
      const situacao = atual?.data?.situacao?.id;
      if (situacao !== undefined && String(situacao) !== String(settings.status_open_id)) {
        return comVinculo({
          status: 'failed',
          error: 'remote_not_open',
          dealPatch: { sync_status: 'divergent', sync_error: 'remote_not_open' },
        });
      }
      escreveu = true;
      await blingRequest(
        db,
        connection.id,
        `/pedidos/vendas/${encodeURIComponent(String(remotoId))}`,
        { method: 'PUT', body: montagem.payload },
        deps
      );
    }
  } catch (erro) {
    if (erro instanceof BlingApiError && erro.status === 404 && atualizar) {
      // Achado pela chave e sumido no meio: a próxima tentativa procura de novo.
      if (achadoPelaChave) return { status: 'retry', error: textoDoErro(erro), uncertain: false };
      return {
        status: 'failed',
        error: 'remote_missing',
        dealPatch: { sync_status: 'divergent', sync_error: 'remote_missing' },
      };
    }
    // POST recusado de vez numa chave gravada AGORA: nada foi criado, e a
    // chave sai — senão a oportunidade ficaria impossível de apagar por um
    // pedido que não existe. 408, 409 e 429 ficam de fora: podem ter passado.
    if (!atualizar && chaveNova && erro instanceof BlingApiError && RECUSA_DEFINITIVA.has(erro.status)) {
      return { status: 'failed', error: textoDoErro(erro), dealPatch: { bling_external_key: null } };
    }
    // PUT é idempotente: repetir não duplica. POST que pode ter passado é
    // incerto até a consulta dizer o contrário.
    return comVinculo(desfechoDoErro(erro, escreveu && !atualizar));
  }

  const idDoPedido = String(remotoId);

  // Conferir o que ficou gravado lá. Uma falha AQUI não desfaz nada: o
  // pedido existe; repete-se só a conferência.
  let remoto: PedidoRemoto | null = null;
  try {
    const lido = await blingRequest<{ data?: PedidoRemoto }>(
      db,
      connection.id,
      `/pedidos/vendas/${encodeURIComponent(idDoPedido)}`,
      {},
      deps
    );
    remoto = lido?.data ?? null;
  } catch {
    remoto = null;
  }

  const diferencas = remoto
    ? compareRemoteOrder(remoto as Record<string, unknown>, { totalCents: montagem.totalCents, itemCount, contactId })
    : [];

  const dealPatch: Record<string, unknown> = {
    bling_order_id: idDoPedido,
    bling_external_key: chave,
    bling_order_number:
      remoto?.numero !== undefined ? String(remoto.numero) : (numeroAchado ?? deal.bling_order_number ?? null),
    sync_status: diferencas.length ? 'divergent' : 'synced',
    sync_error: diferencas.length ? `diff:${diferencas.join(',')}` : null,
    last_synced_at: agora,
    // O incremento é do banco (`bling_finish_operation`); o valor é informativo.
    sync_version: (deal.sync_version ?? 0) + 1,
    // O que o Bling recebeu — enviado AGORA, pelo POST ou pelo PUT. A mudança
    // para Em andamento confere contra isto.
    bling_source_hash: orderSourceHash(pedido),
  };
  if (!deal.order_status) dealPatch.order_status = 'em_aberto';

  const criou = !atualizar || achadoPelaChave;
  const eventos: OrderEvent[] = [
    {
      kind: criou ? 'order_created' : 'order_updated',
      to_status: criou ? 'em_aberto' : null,
      detail: {
        blingOrderId: idDoPedido,
        number: dealPatch.bling_order_number ?? null,
        // Achado pela chave (uma repetição depois de timeout) e atualizado, ou criado agora.
        linkedExisting: achadoPelaChave,
        contact: contato.action,
      },
    },
  ];
  if (diferencas.length) eventos.push({ kind: 'divergence', detail: { fields: diferencas } });

  return {
    status: 'succeeded',
    result: {
      blingOrderId: idDoPedido,
      number: dealPatch.bling_order_number,
      contact: { action: contato.action, filled: contato.filled, differences: contato.differences },
      differences: diferencas,
      payloadHash: montagem.hash,
    },
    dealPatch,
    events: eventos,
  };
}

/**
 * Recusas em que o POST certamente não criou nada. 408 (tempo esgotado no
 * gateway), 409 (conflito — talvez o próprio pedido) e 429 ficam de fora.
 */
const RECUSA_DEFINITIVA = new Set([400, 401, 403, 404, 422]);
