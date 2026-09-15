import { NextResponse } from 'next/server';

import { auditAdmin } from '@/lib/audit/admin-client';
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isMissingObject, loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import { ordersEnableBlockers } from '@/lib/bling/orders-flag';

/**
 * A CHAVE GERAL dos pedidos no Bling (086, Fase 7 item 1).
 *
 * Desligada por padrão. Ligar exige a configuração mínima confirmada — a
 * situação Em aberto, a raiz das categorias e ao menos uma forma de
 * pagamento —, porque sem ela todo envio falharia na montagem do pedido.
 * Desligar é sempre permitido: é o freio.
 */
export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const db = blingAdmin();
    const { data, error } = await db
      .from('bling_settings')
      .select('orders_enabled, company_id, status_open_id, revenue_root_category_id, payment_method_ids')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) {
      if (isMissingObject(error) || error.code === '42703') return NextResponse.json({ state: 'pending' });
      throw new Error(error.message);
    }
    return NextResponse.json({
      state: 'ok',
      enabled: (data as { orders_enabled?: boolean } | null)?.orders_enabled === true,
      blockers: ordersEnableBlockers(data as Parameters<typeof ordersEnableBlockers>[0]),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const corpo = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof corpo?.enabled !== 'boolean') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const db = blingAdmin();
    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state !== 'ok') return NextResponse.json({ error: 'not_connected' }, { status: 409 });

    const { data: atual } = await db
      .from('bling_settings')
      .select('orders_enabled, company_id, status_open_id, revenue_root_category_id, payment_method_ids')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const settings = atual as Parameters<typeof ordersEnableBlockers>[0];

    if (corpo.enabled) {
      const bloqueios = ordersEnableBlockers(settings, conexao.connection.company_id);
      if (bloqueios.length > 0) {
        return NextResponse.json({ error: 'not_ready', blockers: bloqueios }, { status: 409 });
      }
    }
    if (!settings) return NextResponse.json({ ok: true, enabled: false });
    if (settings.orders_enabled === corpo.enabled) return NextResponse.json({ ok: true, enabled: corpo.enabled });

    const { error } = await db
      .from('bling_settings')
      .update({ orders_enabled: corpo.enabled, updated_by: ctx.userId, updated_at: new Date().toISOString() })
      .eq('account_id', ctx.accountId);
    if (error) {
      if (error.code === '42703') return NextResponse.json({ error: 'pending_migration', migration: 86 }, { status: 409 });
      console.error('[bling] não consegui mudar a chave dos pedidos:', error.message);
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }

    await logAuditEvent(auditAdmin(), {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
      action: 'bling.mapping_updated',
      targetType: 'setting',
      targetId: 'bling',
      targetLabel: conexao.connection.company_name,
      metadata: { scope: 'orders_enabled', changes: { orders_enabled: { from: !corpo.enabled, to: corpo.enabled } } },
    });
    return NextResponse.json({ ok: true, enabled: corpo.enabled });
  } catch (err) {
    return toErrorResponse(err);
  }
}
