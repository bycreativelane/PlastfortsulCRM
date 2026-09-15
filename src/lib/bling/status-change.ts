import type { SupabaseClient } from '@supabase/supabase-js';

import { isOrderStatus, type OrderStatus } from '@/lib/deals/order-lock';

import { blingRequest, type ClientDeps } from './client';
import { BlingApiError, BlingConnectionError } from './errors';
import type { Reference } from './health';
import { textoDoErro, type LoadedOrder, type OrderEvent, type OrderOutcome } from './orders';
import {
  blingStatusId,
  canChangeStatus,
  dealPatchForStatus,
  planStatusChange,
  stageForStatus,
  statusFromBlingId,
  transitionActions,
  type ActionKind,
} from './transitions';

/**
 * MUDAR A SITUAÇÃO DO PEDIDO — Fase 5.
 *
 * ------------------------------------------------------------------
 * A ORDEM
 * ------------------------------------------------------------------
 *
 *   1. GET do pedido: ele está onde o CRM acha que está? Se já está no
 *      destino (uma repetição), pula o PATCH. Se está em outro lugar, para:
 *      alguém mexeu no Bling, e a reconciliação (Fase 6) resolve.
 *   2. PATCH `/situacoes/{id}`. Recusa do Bling ("não é possível alterar o
 *      pedido, pois já foram realizadas…") volta COMO ESTÁ, e nada no CRM
 *      muda — nunca parecer que salvou.
 *   3. Contas: consulta o Contas a Receber com origem nesta venda. Achou,
 *      carimba. Não achou e a passagem exige, chama `lancar-contas` e
 *      consulta de novo. `accounts_launched_at` é o que impede o segundo
 *      lançamento quando o job roda três vezes.
 *   4. Estoque: a API não expõe consulta de movimento por pedido. Se a
 *      transição do Bling lança sozinha, carimba; senão chama
 *      `lancar-estoque`, uma vez, e carimba.
 *   5. A oportunidade: situação, etapa que acompanha (D1-B), ganho/perdido
 *      (D3), e uma linha em `deal_order_events` por passo.
 */

interface ContaReceber {
  id?: number | string;
  situacao?: number;
  origem?: { id?: number | string; tipoOrigem?: string };
}

/** As contas a receber que nasceram desta venda, e se estão vivas. */
async function contasDaVenda(
  db: SupabaseClient,
  connectionId: string,
  args: { contactBlingId: string | null; blingOrderId: string; desde: string },
  deps: ClientDeps
): Promise<{ vivas: number; canceladas: number }> {
  const resposta = await blingRequest<{ data?: ContaReceber[] }>(
    db,
    connectionId,
    '/contas/receber',
    {
      query: {
        idContato: args.contactBlingId ?? undefined,
        tipoFiltroData: 'E',
        dataInicial: args.desde,
        pagina: 1,
        limite: 100,
      },
    },
    deps
  );
  const daVenda = (resposta?.data ?? []).filter(
    (c) => c.origem?.tipoOrigem === 'venda' && String(c.origem?.id) === args.blingOrderId
  );
  // 5 cancelado · 4 devolvido: estornadas.
  const canceladas = daVenda.filter((c) => c.situacao === 5 || c.situacao === 4).length;
  return { vivas: daVenda.length - canceladas, canceladas };
}

export interface StatusChangeContext {
  references: ReadonlyArray<Reference>;
  stages: ReadonlyArray<{ id: string; name: string; pipeline_id: string }>;
  operationId: string | null;
  actorId: string | null;
  deps?: ClientDeps;
  now?: () => number;
}

type Evento = OrderEvent;

export async function changeOrderStatus(
  db: SupabaseClient,
  pedido: LoadedOrder,
  destino: string,
  ctx: StatusChangeContext
): Promise<OrderOutcome> {
  const { deal, settings, connection } = pedido;
  const deps = ctx.deps ?? {};
  const agora = new Date((ctx.now ?? Date.now)()).toISOString();
  const eventos: Evento[] = [];

  if (!isOrderStatus(destino)) return { status: 'failed', error: 'invalid_status' };
  if (!settings?.orders_enabled) return { status: 'failed', error: 'orders_disabled' };
  if (!connection || connection.status === 'revoked') return { status: 'failed', error: 'not_connected' };
  if (settings.company_id !== connection.company_id) return { status: 'failed', error: 'company_mismatch' };
  if (!deal.bling_order_id) return { status: 'failed', error: 'order_not_created' };

  const origem = (deal.order_status ?? 'em_aberto') as OrderStatus;
  const destinoId = blingStatusId(settings, destino);
  if (!destinoId) return { status: 'failed', error: 'status_not_mapped' };

  const id = encodeURIComponent(String(deal.bling_order_id));
  let jaNoDestino = false;

  try {
    const atual = await blingRequest<{ data?: { situacao?: { id?: number | string } } }>(
      db,
      connection.id,
      `/pedidos/vendas/${id}`,
      {},
      deps
    );
    const remoto = statusFromBlingId(settings, atual?.data?.situacao?.id);
    if (remoto === destino) {
      jaNoDestino = true;
    } else {
      if (origem === destino) return { status: 'succeeded', result: { unchanged: true }, dealPatch: {} };
      if (!canChangeStatus(origem, destino)) return { status: 'failed', error: 'transition_not_allowed' };
      if (remoto !== origem) {
        return {
          status: 'failed',
          error: 'remote_status_mismatch',
          dealPatch: { sync_status: 'divergent', sync_error: 'remote_status_mismatch' },
        };
      }
    }

    if (!jaNoDestino) {
      await blingRequest(db, connection.id, `/pedidos/vendas/${id}/situacoes/${encodeURIComponent(destinoId)}`, { method: 'PATCH' }, deps);
    }
    eventos.push({ kind: 'status_changed', from_status: origem, to_status: destino, detail: { alreadyThere: jaNoDestino } });
  } catch (erro) {
    return desfechoDaMudanca(erro, eventos, origem, destino);
  }

  // A partir daqui a situação JÁ mudou no Bling. Uma falha nos lançamentos
  // repete a operação — o GET do começo vê o destino e pula o PATCH.
  const plano = planStatusChange({
    to: destino,
    accountsLaunched: !!deal.accounts_launched_at,
    stockLaunched: !!deal.stock_launched_at,
  });
  const automaticas = transitionActions(ctx.references, settings, origem, destino).actions;
  const patch: Record<string, unknown> = {};

  try {
    if (plano.accounts) {
      const desde = deal.sale_date || agora.slice(0, 10);
      const contato = pedido.contact?.bling_contact_id ?? null;
      const consulta = () =>
        contasDaVenda(db, connection.id, { contactBlingId: contato, blingOrderId: String(deal.bling_order_id), desde }, deps);

      if (plano.accounts === 'launch') {
        let contas = await consulta();
        let como: string = automaticas.has('launch_accounts') ? 'transition' : 'found';
        if (contas.vivas === 0) {
          await chamarAcao(db, connection.id, id, 'launch_accounts', deps);
          como = 'explicit';
          contas = await consulta();
        }
        patch.accounts_launched_at = agora;
        eventos.push({ kind: 'accounts_launched', to_status: destino, detail: { by: como, verified: contas.vivas > 0, count: contas.vivas } });
      } else {
        let contas = await consulta();
        let como: string = automaticas.has('reverse_accounts') ? 'transition' : 'found';
        if (contas.vivas > 0) {
          await chamarAcao(db, connection.id, id, 'reverse_accounts', deps);
          como = 'explicit';
          contas = await consulta();
        }
        patch.accounts_launched_at = null;
        eventos.push({ kind: 'accounts_reversed', to_status: destino, detail: { by: como, verified: contas.vivas === 0 } });
      }
    }

    if (plano.stock) {
      const tipo: ActionKind = plano.stock === 'launch' ? 'launch_stock' : 'reverse_stock';
      const pelaTransicao = automaticas.has(tipo);
      if (!pelaTransicao) await chamarAcao(db, connection.id, id, tipo, deps);
      patch.stock_launched_at = plano.stock === 'launch' ? agora : null;
      eventos.push({
        kind: plano.stock === 'launch' ? 'stock_launched' : 'stock_reversed',
        to_status: destino,
        detail: { by: pelaTransicao ? 'transition' : 'explicit', verified: false },
      });
    }
  } catch (erro) {
    // Os carimbos do que JÁ deu certo vão junto: repetir não relança.
    const saida = desfechoDaMudanca(erro, eventos, origem, destino);
    if (saida.status === 'succeeded' || Object.keys(patch).length === 0) return saida;
    return { ...saida, dealPatch: { ...(saida.dealPatch ?? {}), ...patch } };
  }

  const etapa = stageForStatus(ctx.stages, deal.pipeline_id ?? '', destino);
  return {
    status: 'succeeded',
    result: { from: origem, to: destino, alreadyThere: jaNoDestino, stageId: etapa?.id ?? null },
    dealPatch: {
      ...patch,
      ...dealPatchForStatus(destino, etapa?.id ?? null),
      sync_status: 'synced',
      sync_error: null,
      last_synced_at: agora,
      sync_version: (deal.sync_version ?? 0) + 1,
    },
    events: eventos,
  };
}

const CAMINHO_DA_ACAO: Record<ActionKind, string> = {
  launch_accounts: 'lancar-contas',
  reverse_accounts: 'estornar-contas',
  launch_stock: 'lancar-estoque',
  reverse_stock: 'estornar-estoque',
};

async function chamarAcao(
  db: SupabaseClient,
  connectionId: string,
  pedidoId: string,
  tipo: ActionKind,
  deps: ClientDeps
): Promise<void> {
  try {
    await blingRequest(db, connectionId, `/pedidos/vendas/${pedidoId}/${CAMINHO_DA_ACAO[tipo]}`, { method: 'POST' }, deps);
  } catch (erro) {
    // "Já lançado" do Bling é o estado desejado, não uma falha: a consulta
    // não achou (atraso de índice lá), mas o lançamento existe.
    if (erro instanceof BlingApiError && erro.status === 400 && /j[aá]\s+(foi|foram|est[aá])|already/i.test(erro.detail)) {
      return;
    }
    throw erro;
  }
}

function desfechoDaMudanca(
  erro: unknown,
  eventos: Evento[],
  origem: string,
  destino: string
): OrderOutcome {
  if (erro instanceof BlingApiError) {
    if (erro.isTransient || erro.isRateLimited) {
      return { status: 'retry', error: textoDoErro(erro), uncertain: false, events: eventos };
    }
    // A recusa do Bling, como está (§5, Fase 5): "nunca parecer que salvou".
    eventos.push({ kind: 'refused', from_status: origem, to_status: destino, detail: { status: erro.status } });
    return { status: 'failed', error: textoDoErro(erro), events: eventos };
  }
  if (erro instanceof BlingConnectionError) {
    const passageiro = ['refresh_busy', 'refresh_throttled', 'limiter_unavailable'].includes(erro.code);
    return passageiro
      ? ({ status: 'retry', error: erro.code, uncertain: false, events: eventos })
      : ({ status: 'failed', error: erro.code, events: eventos });
  }
  return { status: 'retry', error: 'unexpected', uncertain: false, events: eventos };
}
