import { after, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { blingAdmin } from '@/lib/bling/admin-client';
import { blingOAuthConfig } from '@/lib/bling/oauth';
import { enqueueStatusChange, runOperations } from '@/lib/bling/operations';

/**
 * "Mudar situação" do pedido (Fase 5, D1 = B): ação explícita, com a
 * confirmação na tela dizendo o efeito financeiro antes do clique.
 *
 * A rota confere a passagem (máquina de estados), enfileira e processa
 * depois de responder. O que acontece no Bling — PATCH, lançamentos,
 * estornos — fica em `lib/bling/status-change.ts`, e o histórico em
 * `deal_order_events`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    const ctx = await requireRole('agent');
    const { dealId } = await params;
    if (!blingOAuthConfig()) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

    const corpo = (await request.json().catch(() => null)) as { to?: unknown } | null;
    if (typeof corpo?.to !== 'string') return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

    const db = blingAdmin();
    const { data: ajustes } = await db
      .from('bling_settings')
      .select('orders_enabled')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if ((ajustes as { orders_enabled?: boolean } | null)?.orders_enabled !== true) {
      return NextResponse.json({ error: 'orders_disabled' }, { status: 409 });
    }

    const fila = await enqueueStatusChange(db, { accountId: ctx.accountId, dealId, userId: ctx.userId, to: corpo.to });
    if ('error' in fila) {
      const status = fila.error === 'not_found' ? 404 : fila.error === 'enqueue_failed' ? 500 : 409;
      if (fila.error === 'enqueue_failed') console.error('[bling] não consegui enfileirar a mudança:', fila.detail);
      return NextResponse.json({ error: fila.error }, { status });
    }

    if (fila.status !== 'succeeded') {
      const operationId = fila.operationId;
      after(() => runOperations(db, { operationId }).then(() => undefined));
    }
    return NextResponse.json({ operationId: fila.operationId, status: fila.status }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
