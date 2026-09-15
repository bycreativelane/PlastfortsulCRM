import { NextResponse } from 'next/server';

import { auditAdmin } from '@/lib/audit/admin-client';
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import { isUnderRoot } from '@/lib/bling/categories';
import type { BlingSettingsRow } from '@/lib/bling/health';
import {
  describeSettingsChanges,
  EMPTY_SETTINGS,
  loadReferences,
  validateSettingsPatch,
} from '@/lib/bling/settings';

/**
 * Confirmar os papéis: qual situação é "Em andamento", qual categoria é a raiz,
 * quais formas de pagamento o CRM oferece.
 *
 * Só aceita id que está no cache do Bling, vivo e do tipo certo. Se os papéis
 * gravados eram de OUTRA empresa (a conta reconectou outra), começa do zero —
 * misturar ids de duas empresas é pior que pedir para confirmar de novo.
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const db = blingAdmin();

    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state !== 'ok') return NextResponse.json({ error: 'not_connected' }, { status: 409 });
    const { connection } = conexao;

    const body = await request.json().catch(() => null);
    const referencias = await loadReferences(db, connection.id);
    const validacao = validateSettingsPatch(body, referencias);
    if (!validacao.ok) return NextResponse.json({ error: validacao.error }, { status: 400 });

    const { data: atual } = await db
      .from('bling_settings')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const anterior = atual as BlingSettingsRow | null;
    const mesmaEmpresa = anterior?.company_id === connection.company_id;

    // A categoria padrão ("Demais produtos") precisa estar embaixo da raiz —
    // a que vem neste mesmo pedido ou a já confirmada.
    const padrao = validacao.patch.default_revenue_category_id;
    if (padrao) {
      const raiz =
        validacao.patch.revenue_root_category_id !== undefined
          ? validacao.patch.revenue_root_category_id
          : mesmaEmpresa
            ? anterior?.revenue_root_category_id ?? null
            : null;
      const pai = new Map(
        referencias.filter((r) => r.kind === 'revenue_category').map((r) => [r.bling_id, r.parent_bling_id])
      );
      if (!raiz || padrao === raiz || !isUnderRoot(padrao, raiz, pai)) {
        return NextResponse.json({ error: 'a categoria padrão precisa estar embaixo da raiz confirmada' }, { status: 400 });
      }
    }

    const { error } = await db.from('bling_settings').upsert(
      {
        account_id: ctx.accountId,
        company_id: connection.company_id,
        ...(mesmaEmpresa ? {} : EMPTY_SETTINGS),
        ...validacao.patch,
        updated_by: ctx.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    );
    if (error) {
      console.error('[bling] não consegui gravar os papéis:', error.message);
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }

    const mudancas = describeSettingsChanges(mesmaEmpresa ? anterior : null, validacao.patch, referencias);
    if (Object.keys(mudancas).length > 0) {
      await logAuditEvent(auditAdmin(), {
        accountId: ctx.accountId,
        actorUserId: ctx.userId,
        actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
        action: 'bling.mapping_updated',
        targetType: 'setting',
        targetId: 'bling',
        targetLabel: connection.company_name,
        metadata: { changes: mudancas },
      });
    }

    return NextResponse.json({ ok: true, changed: Object.keys(mudancas) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
