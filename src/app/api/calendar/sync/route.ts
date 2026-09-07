import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/calendar-sync/admin-client';
import {
  loadConnection,
  loadImportableSources,
  runSync,
} from '@/lib/calendar-sync/google/run';

/**
 * "Sincronizar agora" — o botão da tela de Configurações.
 *
 * Ignora o `next_poll_at`: quem clicou está justamente dizendo "não quero
 * esperar os cinco minutos". É o único ponto em que a espera é pulada de
 * propósito, e por isso é de admin — um botão que chama a API da Google
 * sob demanda é uma torneira de cota aberta para quem puder apertá-lo.
 */
export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const admin = supabaseAdmin();

    const connection = await loadConnection(admin, ctx.accountId);
    if (!connection) {
      return NextResponse.json(
        { error: 'nenhuma agenda conectada' },
        { status: 409 }
      );
    }

    const sources = await loadImportableSources(admin, connection.id);
    const outcome = await runSync(admin, connection, sources);

    return NextResponse.json(outcome);
  } catch (err) {
    return toErrorResponse(err);
  }
}
