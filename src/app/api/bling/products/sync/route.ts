import { after, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isMissingObject, loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import { claimSync } from '@/lib/bling/jobs';
import { blingOAuthConfig } from '@/lib/bling/oauth';
import { runProductsImport } from '@/lib/bling/run';

/**
 * "Importar produtos agora". Pega a vez de `products` e importa depois de
 * responder; com catálogo grande, a rodada para no teto de detalhe e o cron
 * continua em minutos.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin');
    if (!blingOAuthConfig()) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

    const db = blingAdmin();
    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state !== 'ok') return NextResponse.json({ error: 'not_connected' }, { status: 409 });
    if (conexao.connection.status === 'revoked') return NextResponse.json({ error: 'revoked' }, { status: 409 });

    let vez: boolean;
    try {
      vez = await claimSync(db, conexao.connection.id, 'products');
    } catch (erro) {
      if (isMissingObject(erro as { code?: string })) {
        return NextResponse.json({ error: 'pending_migration', migration: 83 }, { status: 409 });
      }
      throw erro;
    }
    if (!vez) return NextResponse.json({ error: 'running' }, { status: 409 });

    const connection = conexao.connection;
    after(() => runProductsImport(db, connection));
    return NextResponse.json({ started: true }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
