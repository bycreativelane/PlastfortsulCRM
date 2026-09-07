import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/calendar-sync/admin-client';
import { listCalendars } from '@/lib/calendar-sync/google/client';
import {
  exchangeCode,
  expiresAt,
  fetchAccountEmail,
  googleOAuthConfig,
  verifyState,
} from '@/lib/calendar-sync/google/oauth';
import { encrypt } from '@/lib/whatsapp/encryption';

import { STATE_COOKIE } from '../authorize/route';

/** Para onde a pessoa volta, com o desfecho legível na URL. */
const SETTINGS = '/settings?section=calendars';

/**
 * O retorno da Google.
 *
 * Termina numa REDIREÇÃO para Configurações e não num JSON: quem chega
 * aqui é um navegador no meio de uma navegação de topo, e mostrar-lhe um
 * objeto é abandoná-lo numa página em branco.
 *
 * ------------------------------------------------------------------
 * A ORDEM DAS CONFERÊNCIAS IMPORTA
 * ------------------------------------------------------------------
 *
 * Papel antes do `state`, e `state` antes de trocar o `code`. Trocar o
 * código primeiro gastaria uma autorização real da Google antes de saber
 * se ela era legítima — e um `code` gasto não volta atrás.
 *
 * ------------------------------------------------------------------
 * SEM REFRESH TOKEN, A CONEXÃO NÃO É SALVA
 * ------------------------------------------------------------------
 *
 * A Google só o manda com `access_type=offline` E `prompt=consent`, e a
 * ausência dele significa uma conexão que morre em uma hora. Salvar isso
 * seria criar uma integração que funciona hoje e quebra amanhã sem que
 * ninguém tenha mexido em nada — o pior tipo de bug para diagnosticar.
 * Melhor recusar agora, com uma mensagem que diz o que fazer.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('admin');

    const url = new URL(request.url);
    const denied = url.searchParams.get('error');
    if (denied) {
      return NextResponse.redirect(
        new URL(`${SETTINGS}&calendar=denied`, request.url)
      );
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const jar = await cookies();
    const nonce = jar.get(STATE_COOKIE)?.value ?? '';

    if (!code || !state || !verifyState(state, nonce)) {
      return NextResponse.redirect(
        new URL(`${SETTINGS}&calendar=invalid_state`, request.url)
      );
    }

    const config = googleOAuthConfig();
    if (!config) {
      return NextResponse.redirect(
        new URL(`${SETTINGS}&calendar=not_configured`, request.url)
      );
    }

    const tokens = await exchangeCode(config, code);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        new URL(`${SETTINGS}&calendar=no_refresh_token`, request.url)
      );
    }

    const email = await fetchAccountEmail(tokens.access_token);
    const admin = supabaseAdmin();

    const { data: connection, error } = await admin
      .from('calendar_connections')
      .upsert(
        {
          account_id: ctx.accountId,
          connected_by: ctx.userId,
          provider: 'google',
          provider_email: email,
          refresh_token: encrypt(tokens.refresh_token),
          access_token: encrypt(tokens.access_token),
          access_expires_at: expiresAt(tokens.expires_in),
          scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
          status: 'connected',
          last_error: null,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,provider' }
      )
      .select('id')
      .single();

    if (error || !connection) {
      console.error('[calendar] falha ao gravar a conexão:', error);
      return NextResponse.redirect(
        new URL(`${SETTINGS}&calendar=save_failed`, request.url)
      );
    }

    // As agendas entram DESLIGADAS quanto a escrever: `direction: 'in'` é o
    // padrão da 069, e a principal nem sequer é marcada para publicar. Uma
    // integração que começa escrevendo na agenda de alguém sem que essa
    // pessoa tenha escolhido isso é a definição de surpresa.
    const calendars = await listCalendars(tokens.access_token);
    if (calendars.length > 0) {
      await admin.from('calendar_sources').upsert(
        calendars.map((cal) => ({
          account_id: ctx.accountId,
          connection_id: connection.id,
          external_id: cal.id,
          summary: cal.summary ?? null,
          color: cal.backgroundColor ?? null,
          is_primary: Boolean(cal.primary),
          // Só leitura de saída, e só a principal já habilitada: a lista de
          // uma conta Google traz feriados, aniversários e agendas de
          // colegas, e importar tudo por padrão enche a tela de ruído.
          enabled: Boolean(cal.primary),
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'connection_id,external_id' }
      );
    }

    const response = NextResponse.redirect(
      new URL(`${SETTINGS}&calendar=connected`, request.url)
    );
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (err) {
    return toErrorResponse(err);
  }
}
