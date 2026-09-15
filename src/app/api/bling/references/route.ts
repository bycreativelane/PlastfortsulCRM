import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isMissingObject, loadAccountConnection } from '@/lib/bling/account-connection';
import { blingAdmin } from '@/lib/bling/admin-client';
import { buildHealth, type BlingSettingsRow } from '@/lib/bling/health';
import { isJobRunning, loadJob } from '@/lib/bling/jobs';
import { buildReferenceOptions, loadReferences } from '@/lib/bling/settings';

/**
 * Os cadastros do Bling e a matriz de saúde, para Configurações › Bling.
 *
 * Admin: é a tela onde se confirma qual situação é "Em andamento". Os
 * seletores da gaveta do pedido (Fase 3) leem `bling_references` direto,
 * sob RLS, e não passam por aqui.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    const db = blingAdmin();

    const conexao = await loadAccountConnection(db, ctx.accountId);
    if (conexao.state === 'pending') return NextResponse.json({ connected: false, pending: 82 });
    if (conexao.state === 'none') return NextResponse.json({ connected: false, pending: null });
    const { connection } = conexao;

    let referencias;
    try {
      referencias = await loadReferences(db, connection.id);
    } catch (erro) {
      if (isMissingObject(erro as { code?: string })) {
        return NextResponse.json({ connected: true, pending: 83 });
      }
      throw erro;
    }

    const [{ data: settings }, job] = await Promise.all([
      db.from('bling_settings').select('*').eq('account_id', ctx.accountId).maybeSingle(),
      loadJob(db, connection.id, 'references'),
    ]);

    const health = buildHealth(referencias, settings as BlingSettingsRow | null, connection.company_id);
    const moduloId = health.orderModule.confirmed?.id ?? health.orderModule.suggestion?.id ?? null;
    const porTipo: Record<string, number> = {};
    for (const r of referencias) if (r.removed_at === null) porTipo[r.kind] = (porTipo[r.kind] ?? 0) + 1;

    return NextResponse.json({
      connected: true,
      pending: null,
      connectionStatus: connection.status,
      job: job ? { ...job, running: isJobRunning(job) } : null,
      counts: porTipo,
      health,
      options: buildReferenceOptions(referencias, moduloId),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
