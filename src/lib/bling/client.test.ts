import { afterEach, describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/whatsapp/encryption';

import { blingRequest } from './client';
import { BlingApiError, BlingConnectionError, BlingLeaseLostError } from './errors';
import { fakeDb, type FakeDbOptions } from './fake-db';
import { BLING_TOKEN_URL, type FetchLike } from './oauth';

const CONFIG = {
  clientId: 'id',
  clientSecret: 'segredo',
  redirectUri: 'https://crm.example.com/api/bling/oauth/callback',
};
const AGORA = Date.parse('2026-09-14T12:00:00.000Z');
const agoraFixo = () => AGORA;

type Linha = Record<string, unknown>;

function conexaoValida(): Linha {
  return {
    id: 'conn-1',
    account_id: 'acc-1',
    status: 'connected',
    access_token: encrypt('access-valido'),
    access_expires_at: new Date(AGORA + 3_600_000).toISOString(),
    refresh_token: encrypt('refresh-velho'),
    refresh_lock_token: null,
    refresh_lock_until: null,
    refresh_attempted_at: null,
    consecutive_failures: 0,
    last_success_at: null,
  };
}

/** O balde da 082 respondendo uma fila de valores (o último se repete). */
function balde(valores: number[]) {
  let i = 0;
  return () => valores[Math.min(i++, valores.length - 1)];
}

function claimSimples(_args: Record<string, unknown>, tables: Record<string, Linha[]>) {
  const linha = tables.bling_connections[0];
  if (linha.refresh_lock_token || linha.refresh_attempted_at) return null;
  linha.refresh_lock_token = 'vez-1';
  linha.refresh_lock_until = new Date(AGORA + 30_000).toISOString();
  linha.refresh_attempted_at = new Date(AGORA).toISOString();
  return 'vez-1';
}

function montar(fila: number[], extras: Partial<FakeDbOptions> = {}) {
  return fakeDb({
    tables: { bling_connections: [conexaoValida()] },
    rpcs: { bling_take_request: balde(fila), bling_claim_refresh: claimSimples },
    ...extras,
  });
}

/** API e /oauth/token no mesmo fetch, anotando no log do banco a ordem. */
function blingFalso(
  db: { log: string[] },
  api: (n: number, auth: string) => { status: number; body: unknown }
) {
  let chamadasApi = 0;
  let chamadasToken = 0;
  const impl: FetchLike = async (url, init) => {
    if (url === BLING_TOKEN_URL) {
      chamadasToken++;
      db.log.push('fetch token');
      return new Response(
        JSON.stringify({ access_token: 'access-novo', refresh_token: 'refresh-novo', expires_in: 21600 }),
        { status: 200 }
      );
    }
    chamadasApi++;
    const auth = (init.headers as Record<string, string>).Authorization;
    db.log.push(`fetch api ${auth}`);
    const { status, body } = api(chamadasApi, auth);
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, api: () => chamadasApi, token: () => chamadasToken };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('blingRequest', () => {
  it('token, ficha, chamada, e o sucesso anotado — nessa ordem', async () => {
    const db = montar([0]);
    const bling = blingFalso(db, () => ({ status: 200, body: { data: { id: 'x' } } }));

    const body = await blingRequest(db.client, 'conn-1', '/empresas/me/dados-basicos', {}, {
      config: CONFIG,
      fetchImpl: bling.impl,
      now: agoraFixo,
    });

    expect(body).toEqual({ data: { id: 'x' } });
    expect(db.log).toEqual([
      'select bling_connections',
      'rpc bling_take_request',
      'fetch api Bearer access-valido',
      'update bling_connections',
    ]);
    expect(db.tables.bling_connections[0].last_success_at).toBe('2026-09-14T12:00:00.000Z');
  });

  it('espera o que o balde mandar, e só então chama', async () => {
    const db = montar([700, 0]);
    const bling = blingFalso(db, () => ({ status: 200, body: {} }));
    const sleep = vi.fn(async () => undefined);

    await blingRequest(db.client, 'conn-1', '/x', {}, { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo, sleep });
    expect(sleep).toHaveBeenCalledWith(700);
    expect(db.log.filter((l) => l === 'rpc bling_take_request')).toHaveLength(2);
    expect(bling.api()).toBe(1);
  });

  it('acabou o dia: não chama o Bling', async () => {
    const db = montar([-1]);
    const bling = blingFalso(db, () => ({ status: 200, body: {} }));

    const erro = await blingRequest(db.client, 'conn-1', '/x', {}, { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BlingApiError);
    expect((erro as BlingApiError).type).toBe('daily_limit');
    expect((erro as BlingApiError).isTransient).toBe(false);
    expect(bling.api()).toBe(0);
  });

  it('espera maior que o teto: desiste sem dormir', async () => {
    const db = montar([20_000]);
    const bling = blingFalso(db, () => ({ status: 200, body: {} }));
    const sleep = vi.fn(async () => undefined);

    const erro = await blingRequest(db.client, 'conn-1', '/x', {}, { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo, sleep }).catch((e: unknown) => e);
    expect((erro as BlingApiError).type).toBe('rate_wait');
    expect(sleep).not.toHaveBeenCalled();
    expect(bling.api()).toBe(0);
  });

  it('sem limitador (082 ausente), não chama às cegas', async () => {
    const db = montar([0], {
      errors: { 'rpc bling_take_request': { code: 'PGRST202', message: 'função ausente' } },
    });
    const bling = blingFalso(db, () => ({ status: 200, body: {} }));

    const erro = await blingRequest(db.client, 'conn-1', '/x', {}, { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BlingConnectionError);
    expect((erro as BlingConnectionError).code).toBe('limiter_unavailable');
    expect(bling.api()).toBe(0);
  });

  it('401: renova o token e repete UMA vez, com o token novo', async () => {
    const db = montar([0]);
    const bling = blingFalso(db, (n) =>
      n === 1
        ? { status: 401, body: { error: { type: 'invalid_token', description: 'expired' } } }
        : { status: 200, body: { ok: true } }
    );

    const body = await blingRequest(db.client, 'conn-1', '/x', {}, { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo });
    expect(body).toEqual({ ok: true });
    expect(bling.token()).toBe(1);
    expect(db.log).toContain('fetch api Bearer access-novo');
  });

  it('401 de novo depois de renovar: desiste, sem laço', async () => {
    const db = montar([0]);
    const bling = blingFalso(db, () => ({ status: 401, body: { error: { type: 'invalid_token' } } }));

    const erro = await blingRequest(db.client, 'conn-1', '/x', {}, { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo }).catch((e: unknown) => e);
    expect((erro as BlingApiError).status).toBe(401);
    expect(bling.api()).toBe(2);
    expect(bling.token()).toBe(1);
  });

  it('429 do segundo espera e repete uma vez; 429 do dia não repete', async () => {
    const segundo = montar([0]);
    const sleep = vi.fn(async () => undefined);
    const b1 = blingFalso(segundo, (n) =>
      n === 1
        ? { status: 429, body: { error: { type: 'TOO_MANY_REQUESTS', limit: 3, period: 'second' } } }
        : { status: 200, body: {} }
    );
    await blingRequest(segundo.client, 'conn-1', '/x', {}, { config: CONFIG, fetchImpl: b1.impl, now: agoraFixo, sleep });
    expect(sleep).toHaveBeenCalledWith(1_100);
    expect(b1.api()).toBe(2);

    const dia = montar([0]);
    const b2 = blingFalso(dia, () => ({
      status: 429,
      body: { error: { type: 'TOO_MANY_REQUESTS', limit: 120000, period: 'day' } },
    }));
    const erro = await blingRequest(dia.client, 'conn-1', '/x', {}, { config: CONFIG, fetchImpl: b2.impl, now: agoraFixo }).catch((e: unknown) => e);
    expect((erro as BlingApiError).extra.period).toBe('day');
    expect(b2.api()).toBe(1);
  });

  it('sem configuração no servidor, nem lê a conexão', async () => {
    vi.stubEnv('BLING_CLIENT_ID', '');
    const db = montar([0]);
    const erro = await blingRequest(db.client, 'conn-1', '/x').catch((e: unknown) => e);
    expect((erro as BlingConnectionError).code).toBe('not_configured');
    expect(db.log).toEqual([]);
  });
});

describe('blingRequest — antes de escrever (090)', () => {
  it('beforeWrite vem depois da ficha e antes de cada escrita; leitura não chama', async () => {
    const db = montar([0]);
    const bling = blingFalso(db, () => ({ status: 200, body: { data: { id: 'x' } } }));
    const antes = vi.fn(async () => {
      db.log.push('beforeWrite');
    });
    const deps = { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo, beforeWrite: antes };

    await blingRequest(db.client, 'conn-1', '/pedidos/vendas/1', {}, deps);
    expect(antes).not.toHaveBeenCalled();

    db.log.length = 0;
    await blingRequest(db.client, 'conn-1', '/pedidos/vendas', { method: 'POST', body: {} }, deps);
    expect(db.log).toEqual([
      'select bling_connections',
      'rpc bling_take_request',
      'beforeWrite',
      'fetch api Bearer access-valido',
      'update bling_connections',
    ]);
  });

  it('lease perdido: a escrita não sai', async () => {
    const db = montar([0]);
    const bling = blingFalso(db, () => ({ status: 200, body: {} }));
    await expect(
      blingRequest(db.client, 'conn-1', '/pedidos/vendas/1/situacoes/15', { method: 'PATCH' }, {
        config: CONFIG,
        fetchImpl: bling.impl,
        now: agoraFixo,
        beforeWrite: async () => {
          throw new BlingLeaseLostError('op-1');
        },
      })
    ).rejects.toBeInstanceOf(BlingLeaseLostError);
    expect(bling.api()).toBe(0);
  });

  it('401 numa escrita: confere o lease de novo antes de repetir', async () => {
    const db = montar([0], { rpcs: { bling_take_request: balde([0]), bling_claim_refresh: claimSimples } });
    const bling = blingFalso(db, (n) =>
      n === 1
        ? { status: 401, body: { error: { type: 'invalid_token', description: 'expirou' } } }
        : { status: 200, body: { data: {} } }
    );
    const antes = vi.fn(async () => {});
    await blingRequest(db.client, 'conn-1', '/pedidos/vendas/1', { method: 'PUT', body: {} }, {
      config: CONFIG,
      fetchImpl: bling.impl,
      now: agoraFixo,
      beforeWrite: antes,
    });
    expect(bling.api()).toBe(2);
    expect(antes).toHaveBeenCalledTimes(2);
  });
});
