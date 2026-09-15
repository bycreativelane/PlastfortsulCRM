import { NextResponse, type NextRequest } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  authorizeUrl,
  BLING_SETTINGS_PATH,
  BLING_STATE_COOKIE,
  BLING_STATE_MAX_AGE,
  blingOAuthConfig,
} from '@/lib/bling/oauth';
import { newStateNonce, signState } from '@/lib/oauth/state';

/**
 * Começa a autorização com o Bling.
 *
 * Admin, pelo mesmo motivo da Google (`api/calendar/google/authorize`): a
 * conexão é da conta, e quem autoriza abre o ERP da empresa para o CRM em
 * nome de todo mundo. Na tela, a seção fica atrás de `settings.manage`.
 *
 * Sem configuração, volta para a seção com o desfecho na URL, e não com um
 * JSON 503: quem chega aqui clicou num link, e um objeto cru na janela é uma
 * página quebrada. A Google devolve o JSON, e isso não se copia.
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole('admin');

    const config = blingOAuthConfig();
    if (!config) {
      return NextResponse.redirect(
        new URL(`${BLING_SETTINGS_PATH}&bling=not_configured`, request.url)
      );
    }

    const nonce = newStateNonce();
    const response = NextResponse.redirect(authorizeUrl(config, signState(nonce)));
    response.cookies.set(BLING_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // `lax`: a volta do Bling é uma navegação de topo vinda de outro
      // domínio, e `strict` não mandaria o cookie de volta.
      sameSite: 'lax',
      path: '/',
      maxAge: BLING_STATE_MAX_AGE,
    });
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
