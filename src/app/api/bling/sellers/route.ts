import { NextResponse } from 'next/server';

import { auditAdmin } from '@/lib/audit/admin-client';
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isMissingObject, loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import { loadReferences } from '@/lib/bling/settings';
import { sellerOptions, validateSellerLink } from '@/lib/bling/sellers';

/**
 * Vendedor do Bling por pessoa da equipe (D8, 085).
 *
 * GET devolve os vendedores vivos e os vínculos da empresa conectada; PUT
 * liga ou desliga uma pessoa. `bling_seller_links` só tem política de
 * leitura: a escrita é daqui, com o service role, depois de `requireRole`.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const db = blingAdmin();
    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state !== 'ok') return NextResponse.json({ state: conexao.state });

    const [referencias, vinculos] = await Promise.all([
      loadReferences(db, conexao.connection.id),
      db
        .from('bling_seller_links')
        .select('user_id, bling_seller_id, company_id')
        .eq('account_id', ctx.accountId),
    ]);
    if (vinculos.error) {
      if (isMissingObject(vinculos.error)) return NextResponse.json({ state: 'pending' });
      throw new Error(vinculos.error.message);
    }

    return NextResponse.json({
      state: 'ok',
      sellers: sellerOptions(referencias),
      links: ((vinculos.data ?? []) as Array<{ user_id: string; bling_seller_id: string; company_id: string }>)
        .filter((v) => v.company_id === conexao.connection.company_id)
        .map((v) => ({ userId: v.user_id, sellerId: v.bling_seller_id })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const db = blingAdmin();
    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state !== 'ok') return NextResponse.json({ error: 'not_connected' }, { status: 409 });
    const { connection } = conexao;

    const referencias = await loadReferences(db, connection.id);
    const validacao = validateSellerLink(await request.json().catch(() => null), referencias);
    if (!validacao.ok) return NextResponse.json({ error: validacao.error }, { status: 400 });
    const { userId, sellerId } = validacao.patch;

    // A pessoa é desta conta? `profiles` é a filiação (017).
    const { data: membro } = await db
      .from('profiles')
      .select('user_id, full_name')
      .eq('account_id', ctx.accountId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membro) return NextResponse.json({ error: 'not_a_member' }, { status: 404 });

    const { data: anterior } = await db
      .from('bling_seller_links')
      .select('bling_seller_id')
      .eq('account_id', ctx.accountId)
      .eq('user_id', userId)
      .maybeSingle();

    const resultado = sellerId
      ? await db.from('bling_seller_links').upsert(
          {
            account_id: ctx.accountId,
            user_id: userId,
            bling_seller_id: sellerId,
            company_id: connection.company_id,
            linked_by: ctx.userId,
            linked_at: new Date().toISOString(),
          },
          { onConflict: 'account_id,user_id' }
        )
      : await db.from('bling_seller_links').delete().eq('account_id', ctx.accountId).eq('user_id', userId);

    if (resultado.error) {
      // UNIQUE (account_id, bling_seller_id): o vendedor já é de outra pessoa.
      if (resultado.error.code === '23505') {
        return NextResponse.json({ error: 'seller_taken' }, { status: 409 });
      }
      if (isMissingObject(resultado.error)) return NextResponse.json({ error: 'pending' }, { status: 409 });
      console.error('[bling] não consegui gravar o vendedor:', resultado.error.message);
      return NextResponse.json({ error: 'save_failed' }, { status: 500 });
    }

    const rotulo = (id: string | null | undefined) =>
      id ? (referencias.find((r) => r.kind === 'seller' && r.bling_id === id)?.label ?? id) : null;
    const antes = (anterior as { bling_seller_id: string } | null)?.bling_seller_id ?? null;
    if (antes !== sellerId) {
      await logAuditEvent(auditAdmin(), {
        accountId: ctx.accountId,
        actorUserId: ctx.userId,
        actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
        action: 'bling.mapping_updated',
        targetType: 'setting',
        targetId: 'bling',
        targetLabel: connection.company_name,
        metadata: {
          scope: 'sellers',
          changes: {
            [(membro as { full_name: string | null }).full_name || userId]: {
              from: rotulo(antes),
              to: rotulo(sellerId),
            },
          },
        },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
