import { NextResponse } from 'next/server';

import { auditAdmin } from '@/lib/audit/admin-client';
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { blingAdmin } from '@/lib/bling/admin-client';
import { blingOAuthConfig, revokeToken } from '@/lib/bling/oauth';
import {
  BLING_STATUS_COLUMNS,
  isMissingBlingTable,
  toConnectionView,
  type BlingStatusRow,
} from '@/lib/bling/status';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * O estado da conexão com o Bling, e como desfazê-la.
 *
 * Uma rota, e não um SELECT do navegador: `bling_connections` tem RLS sem
 * política (082), porque a linha guarda um refresh token que abre o ERP.
 *
 * Admin, e não qualquer membro como na Google: lá a agenda importada aparece
 * para todo mundo e "por que isto está aqui?" é pergunta de qualquer um; aqui
 * nada do Bling aparece fora desta seção, que já é de `settings.manage`.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const configured = blingOAuthConfig() !== null;
    const db = blingAdmin();

    const { data, error } = await db
      .from('bling_connections')
      .select(BLING_STATUS_COLUMNS)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      if (isMissingBlingTable(error)) {
        return NextResponse.json({ configured, pending: true, connection: null });
      }
      console.error('[bling] não consegui ler a conexão:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    const row = data as BlingStatusRow | null;
    let connectedByName: string | null = null;
    if (row?.connected_by) {
      const { data: perfil } = await db
        .from('profiles')
        .select('full_name')
        .eq('user_id', row.connected_by)
        .maybeSingle();
      connectedByName = (perfil as { full_name?: string | null } | null)?.full_name ?? null;
    }

    return NextResponse.json({
      configured,
      pending: false,
      connection: row ? toConnectionView(row, connectedByName) : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Desconectar: revoga no Bling e apaga a linha.
 *
 * A revogação é melhor esforço e vem antes; a linha sai de qualquer jeito.
 * Quem desconecta quer que o CRM pare de acessar o ERP, e isso não pode
 * depender de o Bling estar no ar. A resposta diz se a revogação lá deu
 * certo, para a tela avisar quando não deu — aí a autorização continua
 * valendo do lado do Bling até vencer ou alguém revogá-la por lá.
 */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin');
    const db = blingAdmin();

    const { data, error } = await db
      .from('bling_connections')
      .select('id, company_name, refresh_token, access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) {
      if (isMissingBlingTable(error)) return NextResponse.json({ ok: true, revoked: false });
      console.error('[bling] não consegui ler a conexão para desconectar:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const row = data as {
      id: string;
      company_name: string | null;
      refresh_token: string;
      access_token: string | null;
    } | null;
    if (!row) return NextResponse.json({ ok: true, revoked: false });

    let revoked = false;
    const config = blingOAuthConfig();
    if (config) {
      try {
        const [refresh, access] = await Promise.all([
          revokeToken(config, decrypt(row.refresh_token), 'refresh_token'),
          row.access_token
            ? revokeToken(config, decrypt(row.access_token), 'access_token')
            : Promise.resolve(false),
        ]);
        revoked = refresh || access;
      } catch {
        // Um token que não decifra (a ENCRYPTION_KEY mudou) não tem como ser
        // revogado daqui. A linha sai mesmo assim.
        revoked = false;
      }
    }

    const { error: erroApagar } = await db
      .from('bling_connections')
      .delete()
      .eq('id', row.id)
      .eq('account_id', ctx.accountId);
    if (erroApagar) {
      console.error('[bling] não consegui apagar a conexão:', erroApagar.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    await logAuditEvent(auditAdmin(), {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
      action: 'bling.disconnected',
      targetType: 'setting',
      targetId: 'bling',
      targetLabel: row.company_name,
      metadata: { revoked },
    });

    return NextResponse.json({ ok: true, revoked });
  } catch (err) {
    return toErrorResponse(err);
  }
}
