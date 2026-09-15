import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { blingAdmin } from '@/lib/bling/admin-client';
import { isMissingObject } from '@/lib/bling/account-connection';

/**
 * D2: o pedido foi registrado e o ENVIO do orçamento falhou (ou foi feito
 * depois). "Envio pendente" é `sync_status = 'pending'` — coluna que só o
 * servidor escreve (085), por isso a rota.
 *
 * Só mexe em pedido já sincronizado: pendente de envio não é estado de um
 * pedido com erro ou divergente, que continuam mostrando o que são.
 */
export async function POST(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    const ctx = await requireRole('agent');
    const { dealId } = await params;
    const corpo = (await request.json().catch(() => null)) as { event?: unknown } | null;
    if (corpo?.event !== 'send_failed' && corpo?.event !== 'sent') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const db = blingAdmin();
    const { data } = await db
      .from('deals')
      .update({ sync_status: corpo.event === 'send_failed' ? 'pending' : 'synced' })
      .eq('id', dealId)
      .eq('account_id', ctx.accountId)
      .in('sync_status', corpo.event === 'send_failed' ? ['synced'] : ['pending'])
      .select('id');
    return NextResponse.json({ ok: true, changed: (data ?? []).length > 0 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * O estado do pedido desta oportunidade no Bling: o que a oportunidade diz e
 * uma operação da fila — a pedida (`?operationId=`), ou a última. A tela
 * acompanha a operação QUE ELA PEDIU: pelo estado da oportunidade, uma
 * operação mais velha terminando parecia o desfecho desta.
 *
 * `bling_operations` não tem política (086); a leitura é daqui, depois de
 * conferir que a oportunidade é da conta de quem pergunta.
 */
export async function GET(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    const ctx = await requireRole('viewer');
    const { dealId } = await params;
    const db = blingAdmin();

    const { data: deal } = await db
      .from('deals')
      .select(
        'id, order_status, sync_status, sync_error, bling_order_id, bling_external_key, bling_order_number, last_synced_at, accounts_launched_at, stock_launched_at, stage_id, status'
      )
      .eq('id', dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!deal) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const pedida = new URL(request.url).searchParams.get('operationId');
    let consulta = db
      .from('bling_operations')
      .select('id, kind, status, attempts, max_attempts, error, next_attempt_at, finished_at, created_at, result')
      .eq('deal_id', dealId)
      .eq('account_id', ctx.accountId);
    if (pedida && /^[0-9a-f-]{36}$/i.test(pedida)) consulta = consulta.eq('id', pedida);
    const { data: ops, error } = await consulta
      .order('created_at', { ascending: false })
      .limit(1);
    if (error && !isMissingObject(error)) throw new Error(error.message);

    const ultima = ((ops ?? []) as Array<Record<string, unknown>>)[0] ?? null;
    return NextResponse.json({
      deal,
      operation: ultima
        ? {
            id: ultima.id,
            kind: ultima.kind,
            status: ultima.status,
            attempts: ultima.attempts,
            maxAttempts: ultima.max_attempts,
            error: ultima.error,
            nextAttemptAt: ultima.next_attempt_at,
            finishedAt: ultima.finished_at,
            // Só o que a tela usa: diferenças do contato (nomes de campo,
            // nunca valores) e do pedido.
            contactDifferences:
              ((ultima.result as { contact?: { differences?: string[] } } | null)?.contact?.differences ?? []),
            orderDifferences: ((ultima.result as { differences?: string[] } | null)?.differences ?? []),
          }
        : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
