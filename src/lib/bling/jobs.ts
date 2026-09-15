import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * O estado dos trabalhos longos do Bling (`bling_sync_jobs`, 083).
 *
 * `claimSync` pede a vez a `bling_claim_sync()`: um trabalho de cada tipo por
 * conexão, e o botão e o cron chegando juntos não dobram as chamadas. Quem
 * pegou a vez termina com `finishSync` — sempre, inclusive quando falha, ou
 * a vez fica presa até vencer os 15 minutos.
 */

export type SyncJobKind = 'references' | 'products';
export type SyncJobStatus = 'running' | 'ok' | 'partial' | 'error';

export interface SyncJobRow {
  status: SyncJobStatus;
  started_at: string;
  finished_at: string | null;
  last_success_at: string | null;
  error: string | null;
  stats: Record<string, unknown>;
}

export async function claimSync(
  db: SupabaseClient,
  connectionId: string,
  job: SyncJobKind
): Promise<boolean> {
  const { data, error } = await db.rpc('bling_claim_sync', {
    p_connection_id: connectionId,
    p_job: job,
  });
  if (error) {
    throw Object.assign(new Error(`[bling] não consegui pedir a vez de ${job}: ${error.message}`), {
      code: error.code,
    });
  }
  return data === true;
}

export async function finishSync(
  db: SupabaseClient,
  connectionId: string,
  job: SyncJobKind,
  outcome: { status: Exclude<SyncJobStatus, 'running'>; error: string | null; stats: Record<string, unknown> },
  now: number = Date.now()
): Promise<void> {
  const agora = new Date(now).toISOString();
  const { error } = await db
    .from('bling_sync_jobs')
    .update({
      status: outcome.status,
      finished_at: agora,
      error: outcome.error,
      stats: outcome.stats,
      ...(outcome.status === 'error' ? {} : { last_success_at: agora }),
    })
    .eq('connection_id', connectionId)
    .eq('job', job);
  if (error) console.error(`[bling] não consegui encerrar ${job}:`, error.message);
}

export async function loadJob(
  db: SupabaseClient,
  connectionId: string,
  job: SyncJobKind
): Promise<SyncJobRow | null> {
  const { data } = await db
    .from('bling_sync_jobs')
    .select('status, started_at, finished_at, last_success_at, error, stats')
    .eq('connection_id', connectionId)
    .eq('job', job)
    .maybeSingle();
  return (data as SyncJobRow | null) ?? null;
}

/** Quinze minutos: a mesma folga que a função dá para retomar uma vez presa. */
const PRESO_APOS_MS = 15 * 60_000;

/** O trabalho está rodando de verdade — e não preso de um processo que morreu. */
export function isJobRunning(job: SyncJobRow | null, now: number = Date.now()): boolean {
  if (!job || job.status !== 'running') return false;
  const inicio = Date.parse(job.started_at);
  return Number.isNaN(inicio) || now - inicio < PRESO_APOS_MS;
}

/** Vencido: nunca deu certo, ou o último sucesso tem mais de `maxAgeMs`. */
export function isJobDue(job: SyncJobRow | null, maxAgeMs: number, now: number = Date.now()): boolean {
  if (isJobRunning(job, now)) return false;
  if (!job?.last_success_at) return true;
  const ultimo = Date.parse(job.last_success_at);
  return Number.isNaN(ultimo) || now - ultimo >= maxAgeMs;
}

/**
 * O que o tique do cron conta como trabalho LONGO — um por tique: cadastros
 * ou produtos. A fila de pedidos, os webhooks, a reconciliação e a retenção
 * não contam. Contavam: com os pedidos ligados, todo tique tinha "webhooks",
 * e cadastros e produtos nunca mais eram importados.
 */
export function isLongCronJob(iniciado: string): boolean {
  return iniciado.startsWith('references:') || iniciado.startsWith('products:');
}
