import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/calendar-sync/admin-client';
import {
  drainPending,
  loadImportableSources,
  runSync,
} from '@/lib/calendar-sync/google/run';
import type { ConnectionRow } from '@/lib/calendar-sync/google/events';

/**
 * O tique de importação, a cada cinco minutos.
 *
 * Mesmo cabeçalho `x-cron-secret` e mesmo `AUTOMATION_CRON_SECRET` da rota
 * de automações — um segundo segredo para o mesmo agendador seria mais uma
 * variável para alguém esquecer de definir, e o modo de falha disso é uma
 * rota que responde 503 para sempre sem que ninguém perceba.
 *
 * ------------------------------------------------------------------
 * AS DUAS METADES, NUM TIQUE SÓ
 * ------------------------------------------------------------------
 *
 * As duas metades: puxar o que mudou na Google e drenar o que este lado
 * ainda deve escrever. O dreno roda mesmo quando não há fonte vencida — um
 * envio que falhou não deve esperar o relógio de importação de OUTRA
 * agenda para ser tentado de novo.
 *
 * `events.watch` (tempo real) fica para depois, e é decisão do §D6 e não
 * esquecimento: exige endpoint público, tabela de canais e renovação antes
 * de expirar — custo operacional real para ganhar quatro minutos.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }

  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();

  // Todas as contas conectadas, e não só a de quem chamou: o cron não tem
  // sessão. `status = 'connected'` exclui as revogadas, que só voltam
  // quando alguém reconecta pela tela.
  const { data: connections } = await admin
    .from('calendar_connections')
    .select('id, account_id, refresh_token, access_token, access_expires_at')
    .eq('provider', 'google')
    .eq('status', 'connected')
    .limit(200);

  const totals = {
    accounts: 0,
    synced: 0,
    failed: 0,
    imported: 0,
    removed: 0,
    drained: 0,
  };

  for (const connection of (connections ?? []) as ConnectionRow[]) {
    totals.accounts += 1;

    // Só as vencidas: sem isto, cada tique reimportaria toda agenda
    // habilitada de toda conta, a cada cinco minutos, para sempre.
    const sources = await loadImportableSources(admin, connection.id, {
      onlyDue: true,
    });
    if (sources.length > 0) {
      const outcome = await runSync(admin, connection, sources);
      totals.synced += outcome.synced;
      totals.failed += outcome.failed;
      totals.imported += outcome.imported;
      totals.removed += outcome.removed;
    }

    const drain = await drainPending(admin, connection).catch((error) => {
      console.error('[calendar] dreno falhou:', error);
      return { drained: 0, failed: 0 };
    });
    totals.drained += drain.drained;
    totals.failed += drain.failed;
  }

  return NextResponse.json(totals);
}
