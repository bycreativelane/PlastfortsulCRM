import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { loadAccountConnection, type AccountConnection } from './account-connection';
import { blingRequest, type ClientDeps } from './client';
import { BlingContactError, resolveBlingContact, type CrmContact } from './contacts';
import { BlingApiError, BlingConnectionError } from './errors';
import { foldName } from './health';
import { orderReadiness } from '@/lib/deals/order-rules';

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
    sync_version?: number | null;
    accounts_launched_at?: string | null;
    stock_launched_at?: string | null;
    weight_exception_note?: string | null;
  };
  items: OrderSourceItem[];
  installments: OrderSourceInstallment[];
  contact: CrmContact | null;
  carrier: OrderSourceCarrier | null;
  sellerBlingId: string | null;
  settings: {
    company_id: string;
    orders_enabled?: boolean | null;
    status_open_id: string | null;
    payment_method_ids?: string[] | null;
  } | null;
  connection: AccountConnection | null;
  clientTypeId: string | null;
}

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

  const [itens, parcelas, contato, transportadora, ajustes, conexao, dono, tipos] = await Promise.all([
    db.from('deal_items').select('*').eq('deal_id', dealId).order('position', { ascending: true }),
    db.from('deal_installments').select('*').eq('deal_id', dealId).order('position', { ascending: true }),
    d.contact_id
      ? db.from('contacts').select('*').eq('id', d.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    d.carrier_id
      ? db.from('carriers').select('*').eq('id', d.carrier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('bling_settings').select('*').eq('account_id', accountId).maybeSingle(),
    loadAccountConnection(db, accountId).catch(() => ({ state: 'none' as const })),
    // `deals.assigned_to` aponta para `profiles.id`; o vínculo de vendedor é
    // por usuário de auth (085).
    d.assigned_to
      ? db.from('profiles').select('user_id').eq('id', d.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('bling_references').select('bling_id, label').eq('account_id', accountId).eq('kind', 'contact_type').is('removed_at', null),
  ]);

  const settings = (ajustes.data ?? null) as LoadedOrder['settings'];
  const connection = conexao.state === 'ok' ? conexao.connection : null;

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
    items: (itens.data ?? []) as OrderSourceItem[],
    installments: (parcelas.data ?? []) as OrderSourceInstallment[],
    contact: (contato.data ?? null) as CrmContact | null,
    carrier: (transportadora.data ?? null) as OrderSourceCarrier | null,
    sellerBlingId,
    settings,
    connection,
    clientTypeId: cliente?.bling_id ?? null,
  };
}

/**
 * O resumo do pedido GRAVADO — a chave de idempotência da atualização.
 *
 * Do que está no banco e não do payload: o payload precisa do id do cliente
 * no Bling, que pode ainda não existir na hora de enfileirar.
 */
export function orderSourceHash(o: LoadedOrder): string {
  const d = o.deal as unknown as Record<string, unknown>;
  const campos = [
    'sale_date', 'departure_date', 'expected_date', 'delivery_days', 'notes', 'internal_notes',
    'shipping_cost', 'other_expenses', 'general_discount', 'general_discount_unit', 'freight_mode',
    'freight_volumes', 'gross_weight', 'revenue_category_bling_id', 'carrier_id', 'contact_id', 'assigned_to',
  ];
  const resumo = {
    deal: Object.fromEntries(campos.map((c) => [c, d[c] ?? null])),
    items: o.items.map((i) => [i.name, i.sku ?? null, i.unit ?? null, String(i.quantity), String(i.unit_price), String(i.discount_percent), i.bling_product_id ?? null, i.revenue_category_bling_id ?? null, i.defines_order_category ?? null]),
    installments: o.installments.map((p) => [p.due_on, String(p.amount), p.note ?? null, p.payment_method_bling_id ?? null]),
    contact: o.contact ? Object.fromEntries(Object.entries(o.contact).filter(([k]) => !['updated_at', 'last_message_at', 'occurrence_count'].includes(k))) : null,
    carrier: o.carrier,
    seller: o.sellerBlingId,
  };
  return createHash('sha256').update(stableJson(resumo)).digest('hex');
}

/**
 * A lista "Pronto para o Bling" sobre o pedido GRAVADO — a mesma regra da
 * gaveta (`lib/deals/order-rules.ts`), conferida de novo no servidor antes de
 * enfileirar: a lista da tela pode ter ficado verde numa aba aberta há uma
 * hora.
 */
export function readinessOfLoaded(p: LoadedOrder, activeProductIds: ReadonlySet<string> | null) {
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
    activeProductIds,
    weightExceptionNote: p.deal.weight_exception_note ?? null,
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

export type OrderOutcome =
  | { status: 'succeeded'; result: Record<string, unknown>; dealPatch: Record<string, unknown> }
  | { status: 'failed'; error: string; dealPatch?: Record<string, unknown> }
  | { status: 'retry'; error: string; uncertain: boolean };

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
    .map((f) => (f.element ? `${f.element}: ${f.message}` : f.message))
    .filter(Boolean);
  const texto = [`bling:${erro.status || 'sem-resposta'}:${erro.detail}`, ...campos].join(' · ');
  return texto.slice(0, 600);
}

/** Um erro do Bling vira resultado: repetir, ou parar com a mensagem. */
function desfechoDoErro(erro: unknown, depoisDeEscrever: boolean): OrderOutcome {
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
  if (!pedido.contact) return { status: 'failed', error: 'contact_document_missing' };

  // Criar de novo o que já foi criado é o que esta função existe para não
  // fazer: a operação repetida termina sem chamar o Bling.
  if (kind === 'create_order' && deal.bling_order_id) {
    return { status: 'succeeded', result: { alreadyLinked: deal.bling_order_id }, dealPatch: {} };
  }
  if (kind === 'update_order' && !deal.bling_order_id) return { status: 'failed', error: 'order_not_created' };
  if (kind === 'update_order' && (deal.accounts_launched_at || deal.stock_launched_at)) {
    return { status: 'failed', error: 'order_launched' };
  }

  let contato;
  try {
    contato = await resolveBlingContact(db, connection.id, pedido.contact, {
      clientTypeId: pedido.clientTypeId,
      deps,
    });
  } catch (erro) {
    return desfechoDoErro(erro, false);
  }

  const chave = deal.bling_external_key || externalKey(deal.id);
  if (!deal.bling_external_key) {
    // A chave vai para o banco ANTES do POST: é por ela que a próxima
    // tentativa acha o pedido.
    const { error } = await db.from('deals').update({ bling_external_key: chave }).eq('id', deal.id);
    if (error) return { status: 'retry', error: 'save_key_failed', uncertain: false };
  }

  const montagem = buildOrderPayload(
    {
      deal: { ...deal, bling_external_key: chave },
      items: pedido.items,
      installments: pedido.installments,
      contactBlingId: contato.blingId,
      carrier: pedido.carrier,
      sellerBlingId: pedido.sellerBlingId,
      statusOpenId: settings.status_open_id,
      today: opcoes.today,
    },
    kind === 'create_order' ? 'create' : 'update'
  );
  if (!montagem.ok) return { status: 'failed', error: `payload:${montagem.problems.join(',')}` };

  const contactId = Number(contato.blingId);
  const itemCount = (montagem.payload.itens as unknown[]).length;
  let remotoId: string;
  let escreveu = false;

  try {
    if (kind === 'create_order') {
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
      if (achados.length === 1 && achados[0].id !== undefined) {
        remotoId = String(achados[0].id);
      } else {
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
      }
    } else {
      remotoId = String(deal.bling_order_id);
      const atual = await blingRequest<{ data?: PedidoRemoto }>(
        db,
        connection.id,
        `/pedidos/vendas/${encodeURIComponent(remotoId)}`,
        {},
        deps
      );
      const situacao = atual?.data?.situacao?.id;
      if (situacao !== undefined && String(situacao) !== String(settings.status_open_id)) {
        return {
          status: 'failed',
          error: 'remote_not_open',
          dealPatch: { sync_status: 'divergent', sync_error: 'remote_not_open' },
        };
      }
      escreveu = true;
      await blingRequest(
        db,
        connection.id,
        `/pedidos/vendas/${encodeURIComponent(remotoId)}`,
        { method: 'PUT', body: montagem.payload },
        deps
      );
    }
  } catch (erro) {
    // PUT é idempotente: repetir não duplica. POST que pode ter passado é
    // incerto até a consulta dizer o contrário.
    const incerto = escreveu && kind === 'create_order';
    if (erro instanceof BlingApiError && erro.status === 404 && kind === 'update_order') {
      return {
        status: 'failed',
        error: 'remote_missing',
        dealPatch: { sync_status: 'divergent', sync_error: 'remote_missing' },
      };
    }
    return desfechoDoErro(erro, incerto);
  }

  // Conferir o que ficou gravado lá. Uma falha AQUI não desfaz nada: o
  // pedido existe; repete-se só a conferência.
  let remoto: PedidoRemoto | null = null;
  try {
    const lido = await blingRequest<{ data?: PedidoRemoto }>(
      db,
      connection.id,
      `/pedidos/vendas/${encodeURIComponent(remotoId)}`,
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
    bling_order_id: remotoId,
    bling_external_key: chave,
    bling_order_number: remoto?.numero !== undefined ? String(remoto.numero) : (deal.bling_order_number ?? null),
    sync_status: diferencas.length ? 'divergent' : 'synced',
    sync_error: diferencas.length ? `diff:${diferencas.join(',')}` : null,
    last_synced_at: agora,
    sync_version: (deal.sync_version ?? 0) + 1,
  };
  if (kind === 'create_order' && !deal.order_status) dealPatch.order_status = 'em_aberto';

  return {
    status: 'succeeded',
    result: {
      blingOrderId: remotoId,
      number: dealPatch.bling_order_number,
      contact: { action: contato.action, filled: contato.filled, differences: contato.differences },
      differences: diferencas,
      payloadHash: montagem.hash,
    },
    dealPatch,
  };
}
