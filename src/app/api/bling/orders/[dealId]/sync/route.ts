import { after, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { blingAdmin } from '@/lib/bling/admin-client';
import { blingOAuthConfig } from '@/lib/bling/oauth';
import { enqueueOrderSync, runOperations } from '@/lib/bling/operations';
import { loadOrderForBling, readinessOfLoaded } from '@/lib/bling/orders';
import { orderLock } from '@/lib/deals/order-lock';

/**
 * "Registrar no Bling" / "Atualizar no Bling" — e o primeiro passo do envio
 * do orçamento (D2).
 *
 * Confere tudo de novo no servidor, com o pedido GRAVADO: a chave geral, a
 * conexão, a trava da situação e a lista "Pronto para o Bling". Só então
 * enfileira (086) e processa depois de responder. A tela acompanha pelo
 * estado da oportunidade (`GET /api/bling/orders/[dealId]`).
 *
 * Quem manda mensagem pode registrar o pedido: é o vendedor quem envia o
 * orçamento, e o envio é o momento em que o pedido nasce (D2).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    const ctx = await requireRole('agent');
    const { dealId } = await params;
    if (!blingOAuthConfig()) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

    const db = blingAdmin();
    const pedido = await loadOrderForBling(db, ctx.accountId, dealId);
    if (!pedido) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (!pedido.settings?.orders_enabled) return NextResponse.json({ error: 'orders_disabled' }, { status: 409 });
    if (!pedido.connection || pedido.connection.status === 'revoked') {
      return NextResponse.json({ error: 'not_connected' }, { status: 409 });
    }
    if (orderLock(pedido.deal.order_status, pedido.deal.accounts_launched_at) !== 'open') {
      return NextResponse.json({ error: 'order_locked' }, { status: 409 });
    }
    // Compra futura destrava o pedido no CRM, mas o Bling só aceita PUT Em
    // aberto: volte para Em aberto, sincronize, e siga.
    if (pedido.deal.order_status && pedido.deal.order_status !== 'em_aberto') {
      return NextResponse.json({ error: 'order_not_open' }, { status: 409 });
    }

    // Com o snapshot de cada linha conferido contra o produto de agora.
    const prontidao = readinessOfLoaded(pedido);
    if (!prontidao.ready) {
      return NextResponse.json(
        { error: 'not_ready', missing: prontidao.items.filter((i) => !i.ok).map((i) => i.key) },
        { status: 422 }
      );
    }

    const fila = await enqueueOrderSync(db, { accountId: ctx.accountId, dealId, userId: ctx.userId, loaded: pedido });
    if ('error' in fila) {
      if (fila.error === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
      console.error('[bling] não consegui enfileirar o pedido:', fila.detail);
      return NextResponse.json({ error: 'enqueue_failed' }, { status: 500 });
    }

    // Uma operação já terminada com sucesso (o mesmo pedido pedido de novo)
    // não precisa de processamento: responde o que já é.
    if (fila.status !== 'succeeded') {
      const operationId = fila.operationId;
      after(() => runOperations(db, { operationId }).then(() => undefined));
    }
    return NextResponse.json(
      { operationId: fila.operationId, status: fila.status, kind: fila.kind, created: fila.created },
      { status: 202 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
