import { timingSafeEqual } from 'crypto';
import { after, NextResponse } from 'next/server';

import { blingAdmin } from '@/lib/bling/admin-client';
import { claimSync, isJobDue, loadJob } from '@/lib/bling/jobs';
import { blingOAuthConfig } from '@/lib/bling/oauth';
import { runReferencesSync } from '@/lib/bling/run';

/**
 * O tique do Bling, a cada minuto (`docs/configuracao-env.md`).
 *
 * Mesmo `x-cron-secret` e mesmo `AUTOMATION_CRON_SECRET` das automações e da
 * agenda: um segundo segredo para o mesmo agendador é mais uma variável para
 * alguém esquecer.
 *
 * O tique só DECIDE o que está vencido e pega a vez; o trabalho roda em
 * `after()`. Um tique que esperasse a sincronização inteira passaria do
 * minuto e se sobreporia ao próximo.
 *
 * Fase 2: cadastros de referência, uma vez por dia por conexão.
 */

const CADASTROS_VALEM_MS = 24 * 60 * 60_000;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Sem as três variáveis a integração está dormente: nada a fazer, e não é erro.
  if (!blingOAuthConfig()) return NextResponse.json({ dormant: true });

  const db = blingAdmin();
  const { data: conexoes, error } = await db
    .from('bling_connections')
    .select('id, account_id, company_id')
    .neq('status', 'revoked')
    .limit(200);
  if (error) {
    // Antes da 082 não há o que sincronizar.
    return NextResponse.json({ checked: 0, started: [], note: error.code });
  }

  const iniciados: string[] = [];
  for (const conexao of (conexoes ?? []) as Array<{ id: string; account_id: string; company_id: string }>) {
    const job = await loadJob(db, conexao.id, 'references').catch(() => null);
    if (!isJobDue(job, CADASTROS_VALEM_MS)) continue;
    const vez = await claimSync(db, conexao.id, 'references').catch(() => false);
    if (!vez) continue;
    iniciados.push(`references:${conexao.id}`);
    after(() => runReferencesSync(db, conexao));
    // Um trabalho longo por tique: o limitador é por conexão, mas o servidor
    // é um só.
    break;
  }

  return NextResponse.json({ checked: conexoes?.length ?? 0, started: iniciados });
}
