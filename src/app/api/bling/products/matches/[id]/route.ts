import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { blingAdmin } from '@/lib/bling/admin-client';
import { parseMatchAction, resolveMatch } from '@/lib/bling/product-admin';

/**
 * Resolver uma pendência de produto: vincular a um produto existente, criar,
 * ou ignorar. `lib/bling/product-admin.ts` recusa o vínculo que recriaria a
 * ambiguidade (produto já ligado a outro id do Bling).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const acao = parseMatchAction(await request.json().catch(() => null));
    if (!acao) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

    const resultado = await resolveMatch(blingAdmin(), { accountId: ctx.accountId, userId: ctx.userId, matchId: id }, acao);
    if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: resultado.status });
    return NextResponse.json({ ok: true, productId: resultado.productId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
