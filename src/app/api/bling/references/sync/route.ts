import { after, NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isMissingObject, loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import { claimSync } from '@/lib/bling/jobs';
import { blingOAuthConfig } from '@/lib/bling/oauth';
import { runReferencesSync } from '@/lib/bling/run';

/**
 * "Atualizar agora": pega a vez e sincroniza os cadastros depois de responder.
 *
 * São ~30 chamadas ao Bling a 2 por segundo — um quarto de minuto. Segurar a
 * requisição esse tempo todo é pedir um timeout no proxy; responde 202 na hora
 * e a tela acompanha pelo estado do trabalho.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin');
    if (!blingOAuthConfig()) {
      return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const db = blingAdmin();
    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state !== 'ok') return NextResponse.json({ error: 'not_connected' }, { status: 409 });
    if (conexao.connection.status === 'revoked') {
      return NextResponse.json({ error: 'revoked' }, { status: 409 });
    }

    let vez: boolean;
    try {
      vez = await claimSync(db, conexao.connection.id, 'references');
    } catch (erro) {
      if (isMissingObject(erro as { code?: string })) {
        return NextResponse.json({ error: 'pending_migration', migration: 83 }, { status: 409 });
      }
      throw erro;
    }
    if (!vez) return NextResponse.json({ error: 'running' }, { status: 409 });

    const connection = conexao.connection;
    after(() => runReferencesSync(db, connection));
    return NextResponse.json({ started: true }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
