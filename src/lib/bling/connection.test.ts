import { afterEach, describe, expect, it, vi } from 'vitest';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

import { getAccessToken, refreshRevokesConnection } from './connection';
import { BlingApiError, BlingConnectionError } from './errors';
import { fakeDb } from './fake-db';
import type { FetchLike } from './oauth';

const CONFIG = {
  clientId: 'id',
  clientSecret: 'segredo',
  redirectUri: 'https://crm.example.com/api/bling/oauth/callback',
};

const AGORA = Date.parse('2026-09-14T12:00:00.000Z');
const agoraFixo = () => AGORA;
const semEspera = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

type Linha = Record<string, unknown>;

function conexao(sobrescrever: Linha = {}): Linha {
  return {
    id: 'conn-1',
    account_id: 'acc-1',
    status: 'connected',
    access_token: encrypt('access-velho'),
    access_expires_at: new Date(AGORA - 1_000).toISOString(),
    refresh_token: encrypt('refresh-velho'),
    refresh_issued_at: '2026-09-01T00:00:00.000Z',
    refresh_lock_token: null,
    refresh_lock_until: null,
    refresh_attempted_at: null,
    consecutive_failures: 0,
    last_error: null,
    ...sobrescrever,
  };
}

/** `bling_claim_refresh()` da 082, com o relógio do teste. */
function claimRefresh(relogio: () => number) {
  let n = 0;
  return (args: Record<string, unknown>, tables: Record<string, Linha[]>) => {
    const linha = tables.bling_connections.find((l) => l.id === args.p_connection_id);
    const agora = relogio();
    if (!linha || linha.status === 'revoked') return null;
    if (linha.refresh_lock_until && Date.parse(String(linha.refresh_lock_until)) >= agora) return null;
    if (linha.refresh_attempted_at && Date.parse(String(linha.refresh_attempted_at)) >= agora - 60_000) {
      return null;
    }
    linha.refresh_lock_token = `vez-${++n}`;
    linha.refresh_lock_until = new Date(agora + 30_000).toISOString();
    linha.refresh_attempted_at = new Date(agora).toISOString();
    return linha.refresh_lock_token;
  };
}

function banco(linhas: Linha[]) {
  return fakeDb({
    tables: { bling_connections: linhas },
    rpcs: { bling_claim_refresh: claimRefresh(agoraFixo) },
  });
}

/** O /oauth/token, contando as chamadas. */
function tokenEndpoint(
  resposta: (n: number) => { status: number; body: unknown },
  antes?: () => void | Promise<void>
) {
  let chamadas = 0;
  const impl: FetchLike = async () => {
    chamadas++;
    await new Promise((resolve) => setTimeout(resolve, 15));
    await antes?.();
    const { status, body } = resposta(chamadas);
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, contagem: () => chamadas };
}

const TOKENS_NOVOS = {
  access_token: 'access-novo',
  refresh_token: 'refresh-novo',
  expires_in: 21600,
  scope: '1 2',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAccessToken', () => {
  it('token que vale: nenhuma renovação, nenhum pedido de vez', async () => {
    const db = banco([conexao({ access_expires_at: new Date(AGORA + 3_600_000).toISOString() })]);
    const bling = tokenEndpoint(() => ({ status: 200, body: TOKENS_NOVOS }));

    const token = await getAccessToken(db.client, 'conn-1', { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo });
    expect(token).toBe('access-velho');
    expect(bling.contagem()).toBe(0);
    expect(db.log).not.toContain('rpc bling_claim_refresh');
  });

  it('vencido: pede a vez, renova, grava os dois tokens cifrados e solta a vez', async () => {
    const db = banco([conexao()]);
    const bling = tokenEndpoint(() => ({ status: 200, body: TOKENS_NOVOS }));

    const token = await getAccessToken(db.client, 'conn-1', { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo, sleep: semEspera });
    expect(token).toBe('access-novo');

    const linha = db.tables.bling_connections[0];
    expect(decrypt(String(linha.access_token))).toBe('access-novo');
    expect(decrypt(String(linha.refresh_token))).toBe('refresh-novo');
    // Nenhum token em claro no banco.
    expect(JSON.stringify(linha)).not.toMatch(/access-novo|refresh-novo/);
    expect(linha).toMatchObject({
      status: 'connected',
      consecutive_failures: 0,
      refresh_lock_token: null,
      refresh_lock_until: null,
      access_expires_at: '2026-09-14T17:55:00.000Z',
      scopes: ['1', '2'],
    });
  });

  it('refresh token DIFERENTE reinicia os 30 dias; o mesmo, não', async () => {
    const girou = banco([conexao()]);
    await getAccessToken(girou.client, 'conn-1', {
      config: CONFIG,
      fetchImpl: tokenEndpoint(() => ({ status: 200, body: TOKENS_NOVOS })).impl,
      now: agoraFixo,
    });
    expect(girou.tables.bling_connections[0].refresh_issued_at).toBe('2026-09-14T12:00:00.000Z');

    const naoGirou = banco([conexao()]);
    await getAccessToken(naoGirou.client, 'conn-1', {
      config: CONFIG,
      fetchImpl: tokenEndpoint(() => ({
        status: 200,
        body: { ...TOKENS_NOVOS, refresh_token: 'refresh-velho' },
      })).impl,
      now: agoraFixo,
    });
    expect(naoGirou.tables.bling_connections[0].refresh_issued_at).toBe('2026-09-01T00:00:00.000Z');
  });

  it('duas chamadas simultâneas com o token vencido geram UMA renovação', async () => {
    const db = banco([conexao()]);
    const bling = tokenEndpoint(() => ({ status: 200, body: TOKENS_NOVOS }));
    const deps = { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo, sleep: semEspera };

    const [a, b] = await Promise.all([
      getAccessToken(db.client, 'conn-1', deps),
      getAccessToken(db.client, 'conn-1', deps),
    ]);

    expect(bling.contagem()).toBe(1);
    expect([a, b]).toEqual(['access-novo', 'access-novo']);
  });

  it('vez negada e ninguém renovando: não insiste — é o que bloqueia o IP', async () => {
    const db = banco([conexao({ refresh_attempted_at: new Date(AGORA - 10_000).toISOString() })]);
    const bling = tokenEndpoint(() => ({ status: 200, body: TOKENS_NOVOS }));

    const erro = await getAccessToken(db.client, 'conn-1', { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BlingConnectionError);
    expect((erro as BlingConnectionError).code).toBe('refresh_throttled');
    expect(bling.contagem()).toBe(0);
  });

  it('um token recusado força a renovação, mesmo dentro da validade', async () => {
    const db = banco([conexao({ access_expires_at: new Date(AGORA + 3_600_000).toISOString() })]);
    const bling = tokenEndpoint(() => ({ status: 200, body: TOKENS_NOVOS }));

    const token = await getAccessToken(db.client, 'conn-1', { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo }, 'access-velho');
    expect(token).toBe('access-novo');
    expect(bling.contagem()).toBe(1);
  });

  it('recusado, mas outro processo já trocou o token: usa o novo sem renovar', async () => {
    const db = banco([
      conexao({
        access_token: encrypt('access-de-outro'),
        access_expires_at: new Date(AGORA + 3_600_000).toISOString(),
      }),
    ]);
    const bling = tokenEndpoint(() => ({ status: 200, body: TOKENS_NOVOS }));

    const token = await getAccessToken(db.client, 'conn-1', { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo }, 'access-velho');
    expect(token).toBe('access-de-outro');
    expect(bling.contagem()).toBe(0);
  });

  it('o Bling recusa o refresh (invalid_grant): a conexão fica revogada, com o motivo', async () => {
    const db = banco([conexao()]);
    const bling = tokenEndpoint(() => ({
      status: 400,
      body: { error: { type: 'invalid_grant', message: 'invalid_grant', description: 'The refresh token is invalid' } },
    }));

    const erro = await getAccessToken(db.client, 'conn-1', { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BlingConnectionError);
    expect((erro as BlingConnectionError).code).toBe('revoked');
    expect(db.tables.bling_connections[0]).toMatchObject({
      status: 'revoked',
      last_error: 'The refresh token is invalid',
      consecutive_failures: 1,
      refresh_lock_token: null,
    });
  });

  it('falha passageira conta, mas só a terceira seguida vira erro', async () => {
    const indisponivel = () => ({ status: 503, body: { error: { type: 'SERVER_ERROR', description: 'fora do ar' } } });

    const primeira = banco([conexao()]);
    const e1 = await getAccessToken(primeira.client, 'conn-1', {
      config: CONFIG,
      fetchImpl: tokenEndpoint(indisponivel).impl,
      now: agoraFixo,
    }).catch((e: unknown) => e);
    expect((e1 as BlingApiError).isTransient).toBe(true);
    expect(primeira.tables.bling_connections[0]).toMatchObject({ status: 'connected', consecutive_failures: 1 });

    const terceira = banco([conexao({ consecutive_failures: 2 })]);
    await getAccessToken(terceira.client, 'conn-1', {
      config: CONFIG,
      fetchImpl: tokenEndpoint(indisponivel).impl,
      now: agoraFixo,
    }).catch(() => undefined);
    expect(terceira.tables.bling_connections[0]).toMatchObject({ status: 'error', consecutive_failures: 3 });
  });

  it('conexão revogada nem pede a vez; conexão ausente diz que não há conexão', async () => {
    const revogada = banco([conexao({ status: 'revoked' })]);
    const e1 = await getAccessToken(revogada.client, 'conn-1', { config: CONFIG, now: agoraFixo }).catch((e: unknown) => e);
    expect((e1 as BlingConnectionError).code).toBe('revoked');
    expect(revogada.log).not.toContain('rpc bling_claim_refresh');

    const vazia = banco([]);
    const e2 = await getAccessToken(vazia.client, 'conn-1', { config: CONFIG, now: agoraFixo }).catch((e: unknown) => e);
    expect((e2 as BlingConnectionError).code).toBe('not_connected');
  });

  it('o refresh token mudou no meio da renovação: não grava por cima, e solta a vez', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = banco([conexao()]);
    const bling = tokenEndpoint(
      () => ({ status: 200, body: TOKENS_NOVOS }),
      () => {
        // Outro processo, com a vez vencida, renovou e gravou antes.
        db.tables.bling_connections[0].refresh_token = encrypt('refresh-de-outro');
      }
    );

    const token = await getAccessToken(db.client, 'conn-1', { config: CONFIG, fetchImpl: bling.impl, now: agoraFixo });
    expect(token).toBe('access-novo');
    const linha = db.tables.bling_connections[0];
    expect(decrypt(String(linha.refresh_token))).toBe('refresh-de-outro');
    expect(linha.refresh_lock_token).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('refreshRevokesConnection', () => {
  it('revoga: 401, invalid_grant, empresa inativa', () => {
    expect(refreshRevokesConnection(new BlingApiError(401, 'invalid_token', 'x'))).toBe(true);
    expect(refreshRevokesConnection(new BlingApiError(400, 'invalid_grant', 'x'))).toBe(true);
    expect(refreshRevokesConnection(new BlingApiError(400, 'UNAUTHORIZED_ERROR', 'Empresa inativa'))).toBe(true);
  });

  it('não revoga: credenciais do servidor, validação, Bling fora do ar', () => {
    // invalid_client é o .env; a autorização continua boa depois do conserto.
    expect(refreshRevokesConnection(new BlingApiError(400, 'invalid_client', 'x'))).toBe(false);
    expect(refreshRevokesConnection(new BlingApiError(400, 'VALIDATION_ERROR', 'x'))).toBe(false);
    expect(refreshRevokesConnection(new BlingApiError(503, 'SERVER_ERROR', 'x'))).toBe(false);
    expect(refreshRevokesConnection(new BlingApiError(0, 'timeout', 'x'))).toBe(false);
  });
});
