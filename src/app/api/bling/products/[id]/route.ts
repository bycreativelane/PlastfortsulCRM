import { NextResponse } from 'next/server';

import { auditAdmin } from '@/lib/audit/admin-client';
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import { categoriesUnderRoot } from '@/lib/bling/categories';
import type { BlingSettingsRow } from '@/lib/bling/health';
import { loadReferences } from '@/lib/bling/settings';

/**
 * A exceção de um produto (D7): categoria de receita própria, e se ele decide
 * a categoria do pedido ou é item auxiliar (a abraçadeira).
 *
 * Colunas do CRM que a importação nunca escreve. Admin, e com auditoria: mudar
 * a categoria de um produto muda o que vai para o Contas a Receber.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      revenueCategoryId?: unknown;
      definesOrderCategory?: unknown;
    } | null;
    if (!body || (body.revenueCategoryId === undefined && body.definesOrderCategory === undefined)) {
      return NextResponse.json({ error: 'nada para salvar' }, { status: 400 });
    }

    const db = blingAdmin();
    const { data: produto } = await db
      .from('products')
      .select('id, name, revenue_category_bling_id, defines_order_category')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const atual = produto as {
      id: string;
      name: string;
      revenue_category_bling_id: string | null;
      defines_order_category: boolean;
    } | null;
    if (!atual) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const patch: Record<string, unknown> = {};
    const mudancas: Record<string, { from: string | null; to: string | null }> = {};

    if (body.definesOrderCategory !== undefined) {
      if (typeof body.definesOrderCategory !== 'boolean') {
        return NextResponse.json({ error: 'definesOrderCategory precisa ser verdadeiro ou falso' }, { status: 400 });
      }
      if (body.definesOrderCategory !== atual.defines_order_category) {
        patch.defines_order_category = body.definesOrderCategory;
        mudancas.defines_order_category = {
          from: String(atual.defines_order_category),
          to: String(body.definesOrderCategory),
        };
      }
    }

    if (body.revenueCategoryId !== undefined) {
      const valor = body.revenueCategoryId;
      if (valor !== null && typeof valor !== 'string') {
        return NextResponse.json({ error: 'revenueCategoryId precisa ser um id ou null' }, { status: 400 });
      }
      let rotulo = (x: string | null) => x;
      if (valor !== null) {
        const conexao = await loadAccountConnection(db, ctx.accountId);
        if (conexao.state !== 'ok') return NextResponse.json({ error: 'not_connected' }, { status: 409 });
        const [referencias, { data: settings }] = await Promise.all([
          loadReferences(db, conexao.connection.id),
          db.from('bling_settings').select('*').eq('account_id', ctx.accountId).maybeSingle(),
        ]);
        const s = settings as BlingSettingsRow | null;
        const raiz = s && s.company_id === conexao.connection.company_id ? s.revenue_root_category_id : null;
        const validas = categoriesUnderRoot(referencias, raiz);
        if (!validas.some((c) => c.bling_id === valor)) {
          return NextResponse.json({ error: 'a categoria precisa estar embaixo da raiz confirmada' }, { status: 400 });
        }
        rotulo = (x) => (x ? (referencias.find((r) => r.bling_id === x)?.label ?? x) : null);
      }
      if (valor !== atual.revenue_category_bling_id) {
        patch.revenue_category_bling_id = valor;
        mudancas.revenue_category_bling_id = { from: rotulo(atual.revenue_category_bling_id), to: rotulo(valor) };
      }
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, changed: [] });

    const { error } = await db
      .from('products')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', atual.id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[bling] não consegui gravar a exceção do produto:', error.message);
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }

    await logAuditEvent(auditAdmin(), {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
      action: 'bling.mapping_updated',
      targetType: 'product',
      targetId: atual.id,
      targetLabel: atual.name,
      metadata: { changes: mudancas, scope: 'product' },
    });

    return NextResponse.json({ ok: true, changed: Object.keys(mudancas) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
