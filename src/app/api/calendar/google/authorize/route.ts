import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  authorizeUrl,
  googleOAuthConfig,
  newStateNonce,
  signState,
} from '@/lib/calendar-sync/google/oauth';

/** O cookie que segura o nonce entre a ida e a volta. */
export const STATE_COOKIE = 'gcal_oauth_state';

/**
 * Começa a autorização com a Google.
 *
 * ------------------------------------------------------------------
 * `settings.manage`, E POR QUE É ADMIN E NÃO QUALQUER MEMBRO
 * ------------------------------------------------------------------
 *
 * A conexão é da CONTA (§D0): uma só, a da empresa, e todos os membros
 * leem as agendas dela. Quem autoriza está escolhendo em nome de todo
 * mundo — e o refresh token que volta abre a agenda da empresa até alguém
 * revogar. Isso é configuração de conta, não preferência pessoal.
 *
 * ------------------------------------------------------------------
 * O NONCE VAI NO COOKIE E NO `state`, E OS DOIS SÃO CONFERIDOS
 * ------------------------------------------------------------------
 *
 * Sem isso, o callback aceita uma autorização que outro site iniciou:
 * alguém induz um admin logado a abrir o callback com um `code` da conta
 * Google do atacante, e o CRM da vítima passa a publicar as tarefas da
 * empresa na agenda de quem atacou. A tela diria "conectado" — e estaria
 * dizendo a verdade sobre a conta errada.
 *
 * `httpOnly` porque nenhum script da página tem o que fazer com ele;
 * `sameSite: 'lax'` porque o retorno da Google é uma navegação de topo
 * vinda de outro domínio, e `strict` não mandaria o cookie de volta —
 * quebrando o fluxo em vez de protegê-lo.
 */
export async function GET() {
  try {
    await requireRole('admin');

    const config = googleOAuthConfig();
    if (!config) {
      return NextResponse.json(
        { error: 'Google Calendar não está configurado neste servidor' },
        { status: 503 }
      );
    }

    const nonce = newStateNonce();
    const response = NextResponse.redirect(
      authorizeUrl(config, signState(nonce))
    );

    response.cookies.set(STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Noventa segundos: é uma tela de consentimento, não uma sessão.
      maxAge: 90,
    });

    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
