import type { SupabaseClient } from '@supabase/supabase-js';

import { toCents } from '@/lib/money';

import { blingRequest, type ClientDeps } from './client';
import type { BlingSettingsRow } from './health';
import { EXTERNAL_KEY_PREFIX, sourceTotals, type OrderSourceItem } from './order-payload';
import { dealPatchForStatus, stageForStatus, statusFromBlingId } from './transitions';

/**
 * O BLING AVISANDO O CRM — webhook e reconciliação chegam aqui (Fase 6).
 *
 * ------------------------------------------------------------------
 * O QUE MUDA NA OPORTUNIDADE
 * ------------------------------------------------------------------
 *
 * - Situação diferente da do CRM: foi mudança manual no Bling.
 *   `order_status` acompanha, a etapa acompanha (D1-B), fica em
 *   `deal_order_events` com a origem, e o responsável é avisado.
 * - ECO é só o que uma operação do CRM na fila explica: a mudança de
 *   situação pedida para ESTA situação, ou a criação que ainda não terminou.
 *   Qualquer operação pendente fazendo tudo virar eco engolia o cancelamento
 *   feito à mão enquanto uma atualização esperava a próxima tentativa.
 * - Total diferente do gravado: "Divergente", com a diferença, uma vez — a
 *   não ser com criação ou atualização por terminar, que é o CRM mandando.
 * - Pedido apagado no Bling: "Divergente" (`remote_missing`).
 * - A chave achou uma oportunidade já ligada a OUTRO pedido: é um duplicado
 *   lá (`duplicate_remote`), e nada dele é aplicado — nem número, nem
 *   situação, nem cancelamento.
 * - Pedido que não nasceu no CRM (sem `CRM-ORC-`): ignorado no MVP.
 */

export interface RemoteOrderSummary {
  id: string;
  numero: string | null;
  numeroLoja: string | null;
  situacaoId: string | null;
  total: number | null;
  deleted?: boolean;
}

export type ApplyResult = 'updated' | 'unchanged' | 'ignored' | 'diverged' | 'echo';

interface DealRow {
  id: string;
  account_id: string;
  user_id: string | null;
  assigned_to: string | null;
  contact_id: string | null;
  pipeline_id: string | null;
  order_status: string | null;
  bling_order_id: string | null;
  bling_order_number: string | null;
  sync_status: string | null;
  sync_error?: string | null;
  sync_version: number | null;
  shipping_cost?: number | string | null;
  other_expenses?: number | string | null;
  general_discount?: number | string | null;
  general_discount_unit?: string | null;
}

/** Um resumo sem dado pessoal a partir do pedido do Bling (lista ou detalhe). */
export function summarizeRemoteOrder(pedido: Record<string, unknown> | null | undefined): RemoteOrderSummary | null {
  if (!pedido || pedido.id === undefined || pedido.id === null) return null;
  const situacao = pedido.situacao as { id?: unknown } | undefined;
  const texto = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  return {
    id: String(pedido.id),
    numero: texto(pedido.numero),
    numeroLoja: texto(pedido.numeroLoja),
    situacaoId: texto(situacao?.id),
    total: typeof pedido.total === 'number' ? pedido.total : null,
  };
}

/** Avisa quem cuida da oportunidade: o responsável, ou quem a criou. */
export async function notifyOrderOwner(
  db: SupabaseClient,
  deal: Pick<DealRow, 'id' | 'account_id' | 'assigned_to' | 'user_id' | 'contact_id' | 'bling_order_number'>,
  codigo: 'manual_change' | 'divergent' | 'refused'
): Promise<void> {
  let destinatario: string | null = null;
  if (deal.assigned_to) {
    const { data } = await db
      .from('profiles')
      .select('user_id')
      .eq('id', deal.assigned_to)
      .eq('account_id', deal.account_id)
      .maybeSingle();
    destinatario = (data as { user_id?: string } | null)?.user_id ?? null;
  }
  destinatario ??= deal.user_id;
  if (!destinatario) return;
  const { error } = await db.from('notifications').insert({
    account_id: deal.account_id,
    user_id: destinatario,
    type: 'bling_order',
    deal_id: deal.id,
    contact_id: deal.contact_id,
    // O texto é composto na tela (`lib/notifications/text.ts`); aqui vão o
    // número do pedido e o código do acontecimento.
    title: deal.bling_order_number ?? '',
    body: codigo,
  });
  if (error) console.error('[bling] não consegui avisar o responsável:', error.message);
}

export async function applyRemoteOrder(
  db: SupabaseClient,
  args: {
    accountId: string;
    settings: Partial<BlingSettingsRow> | null;
    remote: RemoteOrderSummary;
    source: 'bling' | 'reconcile';
    now?: () => number;
  }
): Promise<ApplyResult> {
  const { remote, settings } = args;
  const agora = new Date((args.now ?? Date.now)()).toISOString();
  const colunas =
    'id, account_id, user_id, assigned_to, contact_id, pipeline_id, order_status, bling_order_id, bling_order_number, sync_status, sync_error, sync_version, shipping_cost, other_expenses, general_discount, general_discount_unit';

  let { data: achado } = await db
    .from('deals')
    .select(colunas)
    .eq('account_id', args.accountId)
    .eq('bling_order_id', remote.id)
    .maybeSingle();

  // Criado pelo CRM e ainda não ligado (uma criação incerta): a chave acha.
  if (!achado && remote.numeroLoja?.startsWith(EXTERNAL_KEY_PREFIX)) {
    ({ data: achado } = await db
      .from('deals')
      .select(colunas)
      .eq('account_id', args.accountId)
      .eq('bling_external_key', remote.numeroLoja)
      .maybeSingle());
  }
  if (!achado) return 'ignored';
  const deal = achado as DealRow;

  // A chave achou uma oportunidade ligada a OUTRO pedido: este é um
  // duplicado no Bling. Nada dele vale para a oportunidade — o número dele
  // no PDF, o cancelamento dele perdendo a venda do pedido de verdade.
  if (deal.bling_order_id && deal.bling_order_id !== remote.id) {
    // Apagar o duplicado é a solução, não uma divergência.
    if (remote.deleted || deal.sync_error === 'duplicate_remote') return 'ignored';
    const { error } = await db
      .from('deals')
      .update({ sync_status: 'divergent', sync_error: 'duplicate_remote' })
      .eq('id', deal.id)
      .eq('account_id', deal.account_id);
    if (error) throw new Error(`[bling] não consegui marcar o pedido duplicado: ${error.message}`);
    await db.from('deal_order_events').insert({
      account_id: deal.account_id,
      deal_id: deal.id,
      source: args.source,
      kind: 'divergence',
      detail: { reason: 'duplicate_remote', remoteId: remote.id, number: remote.numero },
    });
    await notifyOrderOwner(db, deal, 'divergent');
    return 'diverged';
  }

  // O que as operações do CRM por terminar explicam (o eco).
  const { data: pendentes } = await db
    .from('bling_operations')
    .select('kind, params')
    .eq('account_id', args.accountId)
    .eq('deal_id', deal.id)
    .in('status', ['queued', 'running', 'uncertain']);
  const operacoes = (pendentes ?? []) as Array<{ kind: string; params: Record<string, unknown> | null }>;
  const conteudoPendente = operacoes.some((o) => o.kind === 'create_order' || o.kind === 'update_order');
  const situacoesPedidas = new Set(
    operacoes.filter((o) => o.kind === 'change_status').map((o) => String(o.params?.to ?? ''))
  );
  const criacaoPendente = operacoes.some((o) => o.kind === 'create_order');
  let eco = false;

  const origem = args.source;
  const eventos: Array<Record<string, unknown>> = [];
  const patch: Record<string, unknown> = {};
  let aviso: 'manual_change' | 'divergent' | null = null;

  if (!deal.bling_order_id) patch.bling_order_id = remote.id;
  if (remote.numero && remote.numero !== deal.bling_order_number) patch.bling_order_number = remote.numero;

  if (remote.deleted) {
    if (deal.sync_status !== 'divergent') {
      Object.assign(patch, { sync_status: 'divergent', sync_error: 'remote_missing' });
      eventos.push({ kind: 'divergence', detail: { reason: 'remote_missing' } });
      aviso = 'divergent';
    }
  } else {
    const status = statusFromBlingId(settings, remote.situacaoId);
    const pedidoPeloCrm =
      status !== null && (situacoesPedidas.has(status) || (criacaoPendente && !deal.order_status && status === 'em_aberto'));
    if (status && status !== deal.order_status && pedidoPeloCrm) {
      eco = true;
    } else if (status && status !== deal.order_status) {
      let etapaId: string | null = null;
      if (deal.pipeline_id) {
        const { data: etapas } = await db
          .from('pipeline_stages')
          .select('id, name, pipeline_id')
          .eq('pipeline_id', deal.pipeline_id);
        etapaId =
          stageForStatus((etapas ?? []) as Array<{ id: string; name: string; pipeline_id: string }>, deal.pipeline_id, status)?.id ?? null;
      }
      Object.assign(patch, dealPatchForStatus(status, etapaId), {
        last_synced_at: agora,
        sync_version: (deal.sync_version ?? 0) + 1,
      });
      eventos.push({
        kind: 'status_changed',
        from_status: deal.order_status,
        to_status: status,
        // Os carimbos de lançamento não são inferidos: quem mudou à mão no
        // Bling lançou (ou não) pela transição de lá.
        detail: { manual: true, stampsUnknown: status !== 'em_aberto' && status !== 'compra_futura' },
      });
      aviso = 'manual_change';
    }

    if (remote.total !== null && conteudoPendente) {
      // O CRM está mandando o pedido: o total de lá ainda é o de antes.
      eco = true;
    } else if (remote.total !== null) {
      const { data: itens } = await db
        .from('deal_items')
        .select('name, quantity, unit_price, discount_percent')
        .eq('deal_id', deal.id)
        .eq('account_id', deal.account_id);
      const local = sourceTotals(deal as Parameters<typeof sourceTotals>[0], (itens ?? []) as OrderSourceItem[]).totalCents;
      const remoto = toCents(remote.total);
      if (remoto !== local && deal.sync_status !== 'divergent') {
        Object.assign(patch, { sync_status: 'divergent', sync_error: 'diff:total' });
        eventos.push({ kind: 'divergence', detail: { fields: ['total'], remoteCents: remoto, localCents: local } });
        aviso ??= 'divergent';
      }
    }
  }

  if (Object.keys(patch).length === 0) return eco ? 'echo' : 'unchanged';

  const { error } = await db.from('deals').update(patch).eq('id', deal.id).eq('account_id', deal.account_id);
  if (error) throw new Error(`[bling] não consegui aplicar o pedido do Bling: ${error.message}`);

  if (eventos.length) {
    await db.from('deal_order_events').insert(
      eventos.map((e) => ({ account_id: deal.account_id, deal_id: deal.id, source: origem, ...e }))
    );
  }
  if (aviso) {
    await notifyOrderOwner(
      db,
      { ...deal, bling_order_number: (patch.bling_order_number as string | undefined) ?? deal.bling_order_number },
      aviso
    );
  }
  return aviso === 'divergent' ? 'diverged' : aviso === 'manual_change' ? 'updated' : 'unchanged';
}

/** `YYYY-MM-DD HH:MM:SS` no horário de Brasília — o formato do filtro do Bling. */
export function blingDateTime(ms: number): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(ms);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? '00';
  const hora = p('hour') === '24' ? '00' : p('hour');
  return `${p('year')}-${p('month')}-${p('day')} ${hora}:${p('minute')}:${p('second')}`;
}

export const RECONCILE_EVERY_MS = 15 * 60_000;
const SOBREPOSICAO_MS = 10 * 60_000;
const PRIMEIRA_JANELA_MS = 24 * 60 * 60_000;
const PAGINAS = 10;

/**
 * A reconciliação: os pedidos alterados desde o último cursor (menos uma
 * sobreposição), só os do CRM, aplicados como se tivessem chegado por
 * webhook. Cobre o webhook desabilitado e o ambiente sem URL pública.
 */
export async function reconcileOrders(
  db: SupabaseClient,
  conexao: { id: string; account_id: string; orders_cursor: string | null },
  settings: Partial<BlingSettingsRow> | null,
  opcoes: { deps?: ClientDeps; now?: () => number } = {}
): Promise<{ checked: number; updated: number; diverged: number }> {
  const agora = (opcoes.now ?? Date.now)();
  const cursor = conexao.orders_cursor ? Date.parse(conexao.orders_cursor) : agora - PRIMEIRA_JANELA_MS;
  const desde = blingDateTime((Number.isNaN(cursor) ? agora - PRIMEIRA_JANELA_MS : cursor) - SOBREPOSICAO_MS);

  let checked = 0;
  let updated = 0;
  let diverged = 0;
  for (let pagina = 1; pagina <= PAGINAS; pagina++) {
    const lista = await blingRequest<{ data?: Array<Record<string, unknown>> }>(
      db,
      conexao.id,
      '/pedidos/vendas',
      { query: { dataAlteracaoInicial: desde, pagina, limite: 100 } },
      opcoes.deps ?? {}
    );
    const pedidos = lista?.data ?? [];
    for (const bruto of pedidos) {
      const resumo = summarizeRemoteOrder(bruto);
      if (!resumo?.numeroLoja?.startsWith(EXTERNAL_KEY_PREFIX)) continue;
      checked++;
      const r = await applyRemoteOrder(db, {
        accountId: conexao.account_id,
        settings,
        remote: resumo,
        source: 'reconcile',
        now: opcoes.now,
      });
      if (r === 'updated') updated++;
      if (r === 'diverged') diverged++;
    }
    if (pedidos.length < 100) break;
  }

  await db
    .from('bling_connections')
    .update({
      orders_cursor: new Date(agora).toISOString(),
      last_reconcile_at: new Date(agora).toISOString(),
      ...(updated + diverged > 0 ? { reconcile_found_at: new Date(agora).toISOString() } : {}),
    })
    .eq('id', conexao.id);

  return { checked, updated, diverged };
}

/**
 * O webhook está calado? A reconciliação achou mudança depois do último
 * webhook recebido — mudança que o webhook deveria ter trazido.
 */
export function webhookLooksSilent(args: {
  ordersEnabled: boolean;
  lastWebhookAt: string | null;
  reconcileFoundAt: string | null;
}): boolean {
  if (!args.ordersEnabled || !args.reconcileFoundAt) return false;
  const achou = Date.parse(args.reconcileFoundAt);
  if (!args.lastWebhookAt) return true;
  return Date.parse(args.lastWebhookAt) < achou - 30 * 60_000;
}
