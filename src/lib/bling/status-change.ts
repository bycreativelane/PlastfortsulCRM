import type { SupabaseClient } from '@supabase/supabase-js';

import { isOrderStatus, type OrderStatus } from '@/lib/deals/order-lock';

import { blingRequest, type ClientDeps } from './client';
import { BlingApiError, BlingConnectionError, BlingLeaseLostError } from './errors';
import type { Reference } from './health';
import { orderMatchesBling, textoDoErro, type LoadedOrder, type OrderEvent, type OrderOutcome } from './orders';
import {
  blingStatusId,
  canChangeStatus,
  dealPatchForStatus,
  planStatusChange,
  stageForStatus,
  statusFromBlingId,
  statusNeedsSyncedOrder,
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
 *   2. Em andamento lança contas a partir do pedido DO BLING: só com o
 *      pedido do CRM igual ao que o Bling recebeu (`bling_source_hash`, 090).
 *   3. PATCH `/situacoes/{id}`. Recusa do Bling ("não é possível alterar o
 *      pedido, pois já foram realizadas…") volta COMO ESTÁ, e nada no CRM
 *      muda — nunca parecer que salvou.
 *   4. Contas: consulta o Contas a Receber com origem nesta venda, desde a
 *      data DO PEDIDO. Achou, carimba. Não achou e a passagem exige, chama
 *      `lancar-contas`, CARIMBA na hora e consulta de novo.
 *      `accounts_launched_at` é o que impede o segundo lançamento quando o
 *      job roda três vezes.
 *   5. Estoque: a API não expõe consulta de movimento por pedido. Se a
 *      transição do Bling lança sozinha, carimba; senão chama
 *      `lancar-estoque`, uma vez, e carimba.
 *   6. A oportunidade: situação, etapa que acompanha (D1-B), ganho/perdido
 *      (D3), e uma linha em `deal_order_events` por passo.
 *
 * Depois do PATCH a situação JÁ mudou no Bling. Uma falha nos lançamentos
 * que não se resolve repetindo leva a situação para o CRM junto com o erro
 * (e não "recusado"): o CRM dizendo Em aberto de um pedido Em andamento lá
 * seria a divergência que ninguém vê.
 */

interface ContaReceber {
  id?: number | string;
  situacao?: number;
  origem?: { id?: number | string; tipoOrigem?: string };
}

const PAGINAS_DE_CONTAS = 5;
const LIMITE_POR_PAGINA = 100;

/** As contas a receber que nasceram desta venda, e se estão vivas. */
async function contasDaVenda(
  db: SupabaseClient,
  connectionId: string,
  args: { contactBlingId: string | null; blingOrderId: string; desde: string },
  deps: ClientDeps
): Promise<{ vivas: number; canceladas: number }> {
  const daVenda: ContaReceber[] = [];
  for (let pagina = 1; pagina <= PAGINAS_DE_CONTAS; pagina++) {
    const resposta = await blingRequest<{ data?: ContaReceber[] }>(
      db,
      connectionId,
      '/contas/receber',
      {
        query: {
          idContato: args.contactBlingId ?? undefined,
          tipoFiltroData: 'E',
          dataInicial: args.desde,
          pagina,
          limite: LIMITE_POR_PAGINA,
        },
      },
      deps
    );
    const lidas = resposta?.data ?? [];
    daVenda.push(
      ...lidas.filter((c) => c.origem?.tipoOrigem === 'venda' && String(c.origem?.id) === args.blingOrderId)
    );
    if (lidas.length < LIMITE_POR_PAGINA) break;
  }
  // 5 cancelado · 4 devolvido: estornadas.
  const canceladas = daVenda.filter((c) => c.situacao === 5 || c.situacao === 4).length;
  return { vivas: daVenda.length - canceladas, canceladas };
}

const DIAS_DE_FOLGA = 7;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}/;

/**
 * Desde quando procurar as contas: a data do pedido NO BLING (a emissão das
 * contas não é anterior a ela), com folga de fuso e de pedido redatado.
 *
 * A consulta usava a data da venda no CRM ou, sem ela, HOJE em UTC — e
 * cancelar dez dias depois de lançar não achava conta nenhuma: o estorno
 * era pulado e o CRM carimbava "estornado" com as contas vivas no Bling.
 */
export function receivablesSince(args: {
  remoteOrderDate: string | null | undefined;
  saleDate: string | null | undefined;
  createdAt: string | null | undefined;
  now: string;
}): string {
  const valida = (v: string | null | undefined): v is string => typeof v === 'string' && DATA_ISO.test(v);
  // A data do Bling decide; sem ela, a mais antiga que o CRM conhece.
  const base = valida(args.remoteOrderDate)
    ? args.remoteOrderDate.slice(0, 10)
    : ([args.saleDate, args.createdAt, args.now].filter(valida).map((v) => v.slice(0, 10)).sort()[0] ??
      args.now.slice(0, 10));
  const data = new Date(`${base}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() - DIAS_DE_FOLGA);
  return data.toISOString().slice(0, 10);
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
  let dataDoPedido: string | null = null;

  try {
    const atual = await blingRequest<{ data?: { situacao?: { id?: number | string }; data?: string } }>(
      db,
      connection.id,
      `/pedidos/vendas/${id}`,
      {},
      deps
    );
    dataDoPedido = typeof atual?.data?.data === 'string' ? atual.data.data : null;
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
      // A rota conferiu; isto fecha a janela entre a rota e a operação.
      // Repetição que já passou do PATCH (jaNoDestino) completa o que falta.
      if (statusNeedsSyncedOrder(destino) && !orderMatchesBling(pedido)) {
        return { status: 'failed', error: 'order_not_synced' };
      }
    }

    if (!jaNoDestino) {
      await blingRequest(db, connection.id, `/pedidos/vendas/${id}/situacoes/${encodeURIComponent(destinoId)}`, { method: 'PATCH' }, deps);
    }
    eventos.push({ kind: 'status_changed', from_status: origem, to_status: destino, detail: { alreadyThere: jaNoDestino } });
  } catch (erro) {
    return desfechoDaMudanca(erro, eventos, origem, destino, { depoisDaSituacao: false, acao: null });
  }

  // A partir daqui a situação JÁ mudou no Bling. Uma falha passageira repete
  // a operação — o GET do começo vê o destino e pula o PATCH.
  const plano = planStatusChange({
    to: destino,
    accountsLaunched: !!deal.accounts_launched_at,
    stockLaunched: !!deal.stock_launched_at,
  });
  const automaticas = transitionActions(ctx.references, settings, origem, destino).actions;
  const etapa = stageForStatus(ctx.stages, deal.pipeline_id ?? '', destino);
  const patch: Record<string, unknown> = {};
  let acaoAtual: ActionKind | null = null;
  let naoEstornadas = 0;

  try {
    if (plano.accounts) {
      const desde = receivablesSince({
        remoteOrderDate: dataDoPedido,
        saleDate: deal.sale_date,
        createdAt: deal.created_at,
        now: agora,
      });
      const contato = pedido.contact?.bling_contact_id ?? null;
      const consulta = () =>
        contasDaVenda(db, connection.id, { contactBlingId: contato, blingOrderId: String(deal.bling_order_id), desde }, deps);

      if (plano.accounts === 'launch') {
        let contas = await consulta();
        let como: string = automaticas.has('launch_accounts') ? 'transition' : 'found';
        if (contas.vivas === 0) {
          acaoAtual = 'launch_accounts';
          await chamarAcao(db, connection.id, id, 'launch_accounts', deps);
          acaoAtual = null;
          // Carimba ANTES de conferir: se a conferência cair, a repetição
          // não lança de novo.
          patch.accounts_launched_at = agora;
          como = 'explicit';
          contas = await consulta();
        }
        patch.accounts_launched_at = agora;
        eventos.push({ kind: 'accounts_launched', to_status: destino, detail: { by: como, verified: contas.vivas > 0, count: contas.vivas } });
      } else {
        let contas = await consulta();
        let como: string = automaticas.has('reverse_accounts') ? 'transition' : 'found';
        if (contas.vivas > 0) {
          acaoAtual = 'reverse_accounts';
          await chamarAcao(db, connection.id, id, 'reverse_accounts', deps);
          acaoAtual = null;
          como = 'explicit';
          contas = await consulta();
        }
        // O carimbo só sai com as contas estornadas DE FATO. Com contas vivas
        // depois do estorno, o pedido fica divergente e o carimbo continua
        // dizendo que há lançamento.
        if (contas.vivas === 0) patch.accounts_launched_at = null;
        else naoEstornadas = contas.vivas;
        eventos.push({
          kind: 'accounts_reversed',
          to_status: destino,
          detail: { by: como, verified: contas.vivas === 0, remaining: contas.vivas },
        });
      }
    }

    if (plano.stock) {
      const tipo: ActionKind = plano.stock === 'launch' ? 'launch_stock' : 'reverse_stock';
      const pelaTransicao = automaticas.has(tipo);
      if (!pelaTransicao) {
        acaoAtual = tipo;
        await chamarAcao(db, connection.id, id, tipo, deps);
        acaoAtual = null;
      }
      patch.stock_launched_at = plano.stock === 'launch' ? agora : null;
      eventos.push({
        kind: plano.stock === 'launch' ? 'stock_launched' : 'stock_reversed',
        to_status: destino,
        detail: { by: pelaTransicao ? 'transition' : 'explicit', verified: false },
      });
    }
  } catch (erro) {
    const doDestino = {
      ...dealPatchForStatus(destino, etapa?.id ?? null),
      last_synced_at: agora,
      sync_version: (deal.sync_version ?? 0) + 1,
    };
    const saida = desfechoDaMudanca(erro, eventos, origem, destino, { depoisDaSituacao: true, acao: acaoAtual });
    // Repetindo: só os carimbos do que JÁ deu certo — repetir não relança, e
    // a próxima tentativa ainda precisa ver a situação de antes.
    if (saida.status === 'retry') {
      return { ...saida, dealPatch: { ...patch }, finalDealPatch: { ...doDestino, ...patch } };
    }
    if (saida.status === 'failed') return { ...saida, dealPatch: { ...doDestino, ...patch } };
    return saida;
  }

  if (naoEstornadas > 0) {
    eventos.push({ kind: 'divergence', to_status: destino, detail: { reason: 'accounts_not_reversed', remaining: naoEstornadas } });
  }
  return {
    status: 'succeeded',
    result: { from: origem, to: destino, alreadyThere: jaNoDestino, stageId: etapa?.id ?? null },
    dealPatch: {
      ...patch,
      ...dealPatchForStatus(destino, etapa?.id ?? null),
      sync_status: naoEstornadas > 0 ? 'divergent' : 'synced',
      sync_error: naoEstornadas > 0 ? 'accounts_not_reversed' : null,
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
  destino: string,
  quando: { depoisDaSituacao: boolean; acao: ActionKind | null }
): OrderOutcome {
  if (erro instanceof BlingLeaseLostError) {
    return { status: 'retry', error: 'lease_lost', uncertain: false, events: eventos };
  }
  if (erro instanceof BlingApiError) {
    if (erro.isTransient || erro.isRateLimited) {
      return { status: 'retry', error: textoDoErro(erro), uncertain: false, events: eventos };
    }
    if (quando.depoisDaSituacao) {
      // A situação mudou; o lançamento é que falhou. Não é recusa da
      // passagem — é o pedido lá e o financeiro/estoque por fazer.
      eventos.push({
        kind: 'divergence',
        from_status: origem,
        to_status: destino,
        detail: { reason: 'action_failed', action: quando.acao, status: erro.status },
      });
      return { status: 'failed', error: textoDoErro(erro), events: eventos };
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
