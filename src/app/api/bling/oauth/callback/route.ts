import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { auditAdmin } from '@/lib/audit/admin-client';
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log';
import { requireRole, toErrorResponse, type AccountContext } from '@/lib/auth/account';
import { blingAdmin } from '@/lib/bling/admin-client';
import { completeAuthorization } from '@/lib/bling/authorize';
import { describeBlingFailure } from '@/lib/bling/errors';
import {
  BLING_SETTINGS_PATH,
  BLING_STATE_COOKIE,
  blingOAuthConfig,
} from '@/lib/bling/oauth';
import { verifyState } from '@/lib/oauth/state';

/**
 * A volta do Bling.
 *
 * Termina SEMPRE numa redireção para Configurações › Bling, com o desfecho
 * em `?bling=`: quem chega aqui é um navegador no meio de uma navegação de
 * topo. Inclusive quando algo lança — a Google devolve um JSON 500 nesse
 * caso, e a pessoa fica olhando um objeto na janela.
 *
 * O papel e o `state` vêm antes de tudo; o resto da ordem (código gravado
 * antes da troca, empresa conferida antes de gravar) está em
 * `lib/bling/authorize.ts`, onde tem teste.
 *
 * O cookie do `state` sai em qualquer desfecho: ele é de uma tentativa só.
 */
export async function GET(request: NextRequest) {
  let ctx: AccountContext;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const voltar = (desfecho: string) => {
    const response = NextResponse.redirect(
      new URL(`${BLING_SETTINGS_PATH}&bling=${desfecho}`, request.url)
    );
    response.cookies.delete(BLING_STATE_COOKIE);
    return response;
  };

  try {
    const url = new URL(request.url);
    const state = url.searchParams.get('state') ?? '';
    const nonce = (await cookies()).get(BLING_STATE_COOKIE)?.value ?? '';
    if (!verifyState(state, nonce)) return voltar('invalid_state');

    // `access_denied` e companhia: a pessoa recusou, ou o aplicativo está
    // inativo. Nada foi autorizado, nada a desfazer.
    if (url.searchParams.get('error')) return voltar('denied');

    const code = url.searchParams.get('code');
    if (!code) return voltar('invalid_state');

    const config = blingOAuthConfig();
    if (!config) return voltar('not_configured');

    const result = await completeAuthorization(
      { accountId: ctx.accountId, userId: ctx.userId, code, config },
      { db: blingAdmin() }
    );

    if (result.outcome === 'connected' && result.company) {
      await logAuditEvent(auditAdmin(), {
        accountId: ctx.accountId,
        actorUserId: ctx.userId,
        actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
        action: 'bling.connected',
        targetType: 'setting',
        targetId: 'bling',
        targetLabel: result.company.name,
        // Nunca os tokens. O id da empresa é do ERP, não de uma pessoa.
        metadata: {
          company_id: result.company.id,
          reconnected: result.reconnected ?? false,
          scopes: result.scopes ?? 0,
        },
      });
    }

    return voltar(result.outcome);
  } catch (err) {
    console.error('[bling] o callback falhou:', describeBlingFailure(err));
    return voltar('failed');
  }
}
