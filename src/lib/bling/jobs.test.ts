import { describe, expect, it } from 'vitest';

import { isJobDue, isJobRunning, isLongCronJob, type SyncJobRow } from './jobs';

const AGORA = Date.parse('2026-09-15T12:00:00.000Z');
const DIA = 24 * 60 * 60_000;

const job = (over: Partial<SyncJobRow>): SyncJobRow => ({
  status: 'ok',
  started_at: '2026-09-15T11:00:00.000Z',
  finished_at: '2026-09-15T11:01:00.000Z',
  last_success_at: '2026-09-15T11:01:00.000Z',
  error: null,
  stats: {},
  ...over,
});

describe('isJobRunning', () => {
  it('rodando há pouco: sim; preso há mais de 15 minutos: não', () => {
    expect(isJobRunning(job({ status: 'running', started_at: '2026-09-15T11:50:00.000Z' }), AGORA)).toBe(true);
    expect(isJobRunning(job({ status: 'running', started_at: '2026-09-15T11:40:00.000Z' }), AGORA)).toBe(false);
    expect(isJobRunning(null, AGORA)).toBe(false);
  });
});

describe('isJobDue', () => {
  it('nunca deu certo, ou o sucesso é velho: vencido', () => {
    expect(isJobDue(null, DIA, AGORA)).toBe(true);
    expect(isJobDue(job({ status: 'error', last_success_at: null }), DIA, AGORA)).toBe(true);
    expect(isJobDue(job({ last_success_at: '2026-09-14T11:00:00.000Z' }), DIA, AGORA)).toBe(true);
  });

  it('sucesso recente, ou rodando agora: não vencido', () => {
    expect(isJobDue(job({}), DIA, AGORA)).toBe(false);
    expect(isJobDue(job({ status: 'running', started_at: '2026-09-15T11:59:00.000Z', last_success_at: null }), DIA, AGORA)).toBe(false);
  });
});

describe('isLongCronJob', () => {
  it('só cadastros e produtos contam como trabalho longo do tique', () => {
    expect(isLongCronJob('references:conn-1')).toBe(true);
    expect(isLongCronJob('products:conn-1')).toBe(true);
    // Com os pedidos ligados, todo tique tem estes — e eles não podem
    // impedir a importação de cadastros e produtos.
    for (const curto of ['operations:acc-1', 'webhooks', 'reconcile:conn-1', 'retention']) {
      expect(isLongCronJob(curto)).toBe(false);
    }
  });
});
