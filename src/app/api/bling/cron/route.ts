import { timingSafeEqual } from 'crypto';
import { after, NextResponse } from 'next/server';

import { blingAdmin } from '@/lib/bling/admin-client';
import { claimSync, isJobDue, isLongCronJob, loadJob } from '@/lib/bling/jobs';
import { blingOAuthConfig } from '@/lib/bling/oauth';
import type { BlingSettingsRow } from '@/lib/bling/health';
import { runOperations } from '@/lib/bling/operations';
import { reconcileOrders, RECONCILE_EVERY_MS } from '@/lib/bling/reconcile';
import { processWebhookEvents } from '@/lib/bling/webhook';
import { productsMaxAgeMs, runProductsImport, runReferencesSync } from '@/lib/bling/run';

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
 * Fase 2: cadastros de referência uma vez por dia por conexão; produtos uma
 * vez por dia, ou em dez minutos quando a última rodada deixou produto para
 * trás (o teto de detalhe por rodada).
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

  // Fase 4: a fila de escritas no Bling (086). Toda conexão viva com a chave
  // geral ligada — são operações curtas, uma a uma, e o lease impede que o
  // `after()` da rota e o cron peguem a mesma.
  const { data: ligadas } = await db
    .from('bling_settings')
    .select('account_id')
    .eq('orders_enabled', true)
    .limit(200);
  const contasComPedido = new Set(((ligadas ?? []) as Array<{ account_id: string }>).map((s) => s.account_id));
  for (const conexao of (conexoes ?? []) as Array<{ account_id: string }>) {
    if (!contasComPedido.has(conexao.account_id)) continue;
    const accountId = conexao.account_id;
    iniciados.push(`operations:${accountId}`);
    after(() => runOperations(db, { accountId, limit: 10 }).then(() => undefined));
  }

  // Fase 6 (089): os webhooks que o `after()` da rota não terminou, a
  // reconciliação a cada ~15 min das contas com pedidos, e a retenção uma
  // vez por dia — chamada de fato, e não só escrita.
  if (contasComPedido.size > 0) {
    iniciados.push('webhooks');
    after(() => processWebhookEvents(db, { limit: 50 }).then(() => undefined));

    const { data: saude, error: semColunas } = await db
      .from('bling_connections')
      .select('id, account_id, orders_cursor, last_reconcile_at')
      .neq('status', 'revoked')
      .limit(200);
    if (!semColunas) {
      const agora = Date.now();
      for (const c of (saude ?? []) as Array<{ id: string; account_id: string; orders_cursor: string | null; last_reconcile_at: string | null }>) {
        if (!contasComPedido.has(c.account_id)) continue;
        const ultima = c.last_reconcile_at ? Date.parse(c.last_reconcile_at) : 0;
        if (agora - ultima < RECONCILE_EVERY_MS) continue;
        iniciados.push(`reconcile:${c.id}`);
        after(async () => {
          const { data: ajustes } = await db.from('bling_settings').select('*').eq('account_id', c.account_id).maybeSingle();
          await reconcileOrders(db, c, ajustes as Partial<BlingSettingsRow> | null).catch((erro) =>
            console.error('[bling] reconciliação:', erro instanceof Error ? erro.message : erro)
          );
        });
      }
    }
  }

  const { data: manutencao, error: semManutencao } = await db
    .from('bling_maintenance')
    .select('last_run_at')
    .eq('task', 'retention')
    .maybeSingle();
  const ultimaRetencao = (manutencao as { last_run_at?: string | null } | null)?.last_run_at;
  if (!semManutencao && (!ultimaRetencao || Date.now() - Date.parse(ultimaRetencao) > 24 * 60 * 60_000)) {
    iniciados.push('retention');
    after(async () => {
      const { error: erro } = await db.rpc('bling_purge', { p_event_days: 30, p_operation_days: 180 });
      if (erro) console.error('[bling] retenção:', erro.message);
    });
  }

  for (const conexao of (conexoes ?? []) as Array<{ id: string; account_id: string; company_id: string }>) {
    // Um trabalho LONGO por tique (cadastros ou produtos) — `isLongCronJob`.
    if (iniciados.some(isLongCronJob)) break;

    // Cadastros primeiro: a importação de produtos lê o rótulo das famílias
    // do cache que eles preenchem.
    const cadastros = await loadJob(db, conexao.id, 'references').catch(() => null);
    if (isJobDue(cadastros, CADASTROS_VALEM_MS)) {
      if (await claimSync(db, conexao.id, 'references').catch(() => false)) {
        iniciados.push(`references:${conexao.id}`);
        after(() => runReferencesSync(db, conexao));
      }
      // Um trabalho longo por tique: o limitador é por conexão, mas o
      // servidor é um só.
      continue;
    }
    if (!cadastros?.last_success_at) continue;

    const produtos = await loadJob(db, conexao.id, 'products').catch(() => null);
    if (isJobDue(produtos, productsMaxAgeMs(produtos?.stats))) {
      if (await claimSync(db, conexao.id, 'products').catch(() => false)) {
        iniciados.push(`products:${conexao.id}`);
        after(() => runProductsImport(db, conexao));
      }
    }
  }

  return NextResponse.json({ checked: conexoes?.length ?? 0, started: iniciados });
}
