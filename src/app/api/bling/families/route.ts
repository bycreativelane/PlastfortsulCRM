import { NextResponse } from 'next/server';

import { auditAdmin } from '@/lib/audit/admin-client';
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import type { BlingSettingsRow } from '@/lib/bling/health';
import { validateFamilyPatch } from '@/lib/bling/product-admin';
import { loadReferences } from '@/lib/bling/settings';

/**
 * Família → categoria de receita (D7), confirmada por um admin.
 *
 * Aceita vários de uma vez — "confirmar as sugestões" manda todas — e só
 * categoria viva embaixo da raiz confirmada: a especificação exige que a
 * cadeia de pais termine em "Venda direta".
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const db = blingAdmin();

    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state !== 'ok') return NextResponse.json({ error: 'not_connected' }, { status: 409 });
    const { connection } = conexao;

    const [referencias, { data: settings }] = await Promise.all([
      loadReferences(db, connection.id),
      db.from('bling_settings').select('*').eq('account_id', ctx.accountId).maybeSingle(),
    ]);
    const s = settings as BlingSettingsRow | null;
    const raiz = s && s.company_id === connection.company_id ? s.revenue_root_category_id : null;

    const validacao = validateFamilyPatch(await request.json().catch(() => null), referencias, raiz);
    if (!validacao.ok) return NextResponse.json({ error: validacao.error }, { status: 400 });

    const { data: atuais } = await db
      .from('bling_family_categories')
      .select('family_bling_id, revenue_category_bling_id, company_id')
      .eq('account_id', ctx.accountId);
    const antes = new Map(
      ((atuais ?? []) as Array<{ family_bling_id: string; revenue_category_bling_id: string; company_id: string }>)
        .filter((m) => m.company_id === connection.company_id)
        .map((m) => [m.family_bling_id, m.revenue_category_bling_id])
    );

    const rotulo = (id: string | null | undefined) =>
      id ? (referencias.find((r) => r.bling_id === id)?.label ?? id) : null;
    const mudancas: Record<string, { from: string | null; to: string | null }> = {};
    const agora = new Date().toISOString();

    for (const { familyId, categoryId } of validacao.mappings) {
      const anterior = antes.get(familyId) ?? null;
      if (anterior === categoryId) continue;
      const resultado = categoryId
        ? await db.from('bling_family_categories').upsert(
            {
              account_id: ctx.accountId,
              family_bling_id: familyId,
              revenue_category_bling_id: categoryId,
              company_id: connection.company_id,
              confirmed_by: ctx.userId,
              confirmed_at: agora,
            },
            { onConflict: 'account_id,family_bling_id' }
          )
        : await db
            .from('bling_family_categories')
            .delete()
            .eq('account_id', ctx.accountId)
            .eq('family_bling_id', familyId);
      if (resultado.error) {
        console.error('[bling] não consegui gravar o mapa de família:', resultado.error.message);
        return NextResponse.json({ error: 'save_failed' }, { status: 500 });
      }
      mudancas[rotulo(familyId) ?? familyId] = { from: rotulo(anterior), to: rotulo(categoryId) };
    }

    if (Object.keys(mudancas).length > 0) {
      await logAuditEvent(auditAdmin(), {
        accountId: ctx.accountId,
        actorUserId: ctx.userId,
        actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
        action: 'bling.mapping_updated',
        targetType: 'setting',
        targetId: 'bling',
        targetLabel: connection.company_name,
        metadata: { changes: mudancas, scope: 'families' },
      });
    }
    return NextResponse.json({ ok: true, changed: Object.keys(mudancas).length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
