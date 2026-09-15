import { afterEach, describe, expect, it, vi } from 'vitest';

import { decrypt } from '@/lib/whatsapp/encryption';

import { completeAuthorization, hashAuthorizationCode } from './authorize';
import { fakeDb, type FakeDbOptions } from './fake-db';
import { BLING_REVOKE_URL, BLING_TOKEN_URL, type FetchLike } from './oauth';

const CONFIG = {
  clientId: 'id',
  clientSecret: 'segredo',
  redirectUri: 'https://crm.example.com/api/bling/oauth/callback',
};
const AGORA = Date.parse('2026-09-14T12:00:00.000Z');
const ENTRADA = { accountId: 'acc-1', userId: 'user-1', code: 'codigo-de-um-minuto', config: CONFIG };

type Linha = Record<string, unknown>;

function montar(extras: Partial<FakeDbOptions> = {}) {
  return fakeDb({
    unique: { bling_oauth_codes: ['code_hash'], bling_connections: ['account_id'] },
    ...extras,
  });
}

/** O Bling inteiro: token, dados básicos e revogação, com o log do banco. */
function blingFalso(
  db: { log: string[] },
  opcoes: {
    token?: { status: number; body: unknown };
    empresa?: { status: number; body: unknown };
  } = {}
) {
  const revogados: string[] = [];
  let trocas = 0;
  const impl: FetchLike = async (url, init) => {
    if (url === BLING_TOKEN_URL) {
      trocas++;
      db.log.push('fetch token');
      const r = opcoes.token ?? {
        status: 200,
        body: { access_token: 'access-novo', refresh_token: 'refresh-novo', expires_in: 21600, scope: '1 2 3' },
      };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    if (url === BLING_REVOKE_URL) {
      db.log.push('fetch revoke');
      revogados.push(new URLSearchParams(String(init.body)).get('token') ?? '');
      return new Response(null, { status: 200 });
    }
    db.log.push('fetch empresa');
    const r = opcoes.empresa ?? {
      status: 200,
      body: { data: { id: 'empresa-b', nome: 'Empresa B Ltda', cnpj: '12.345.678/0001-95' } },
    };
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return { impl, revogados, trocas: () => trocas };
}

function conexaoExistente(sobrescrever: Linha): Linha {
  return {
    id: 'conn-1',
    account_id: 'acc-1',
    company_id: 'empresa-a',
    company_name: 'Empresa A',
    status: 'connected',
    consecutive_failures: 2,
    ...sobrescrever,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('completeAuthorization — a ordem do callback', () => {
  it('grava o hash do código ANTES de qualquer chamada ao Bling, e nunca o código', async () => {
    const db = montar();
    const bling = blingFalso(db);

    await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl, now: () => AGORA });

    expect(db.log.indexOf('insert bling_oauth_codes')).toBeLessThan(db.log.indexOf('fetch token'));
    const [reserva] = db.tables.bling_oauth_codes;
    expect(reserva.code_hash).toBe(hashAuthorizationCode('codigo-de-um-minuto'));
    expect(reserva.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db.tables.bling_oauth_codes)).not.toContain('codigo-de-um-minuto');
  });

  it('o segundo acerto com o mesmo código não troca de novo — reusar revoga o usuário', async () => {
    const db = montar();
    const bling = blingFalso(db);
    const deps = { db: db.client, fetchImpl: bling.impl, now: () => AGORA };

    const primeira = await completeAuthorization(ENTRADA, deps);
    const segunda = await completeAuthorization(ENTRADA, deps);

    expect(primeira.outcome).toBe('connected');
    expect(segunda.outcome).toBe('duplicate');
    expect(bling.trocas()).toBe(1);
  });

  it('conecta: empresa gravada, tokens só cifrados, contadores zerados', async () => {
    const db = montar();
    const bling = blingFalso(db);

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl, now: () => AGORA });
    expect(resultado).toEqual({
      outcome: 'connected',
      company: { id: 'empresa-b', name: 'Empresa B Ltda', cnpj: '12.345.678/0001-95' },
      reconnected: false,
      scopes: 3,
    });

    const [linha] = db.tables.bling_connections;
    expect(linha).toMatchObject({
      account_id: 'acc-1',
      connected_by: 'user-1',
      company_id: 'empresa-b',
      company_name: 'Empresa B Ltda',
      status: 'connected',
      consecutive_failures: 0,
      scopes: ['1', '2', '3'],
      refresh_issued_at: '2026-09-14T12:00:00.000Z',
      access_expires_at: '2026-09-14T17:55:00.000Z',
    });
    expect(decrypt(String(linha.refresh_token))).toBe('refresh-novo');
    expect(JSON.stringify(linha)).not.toMatch(/access-novo|refresh-novo/);
    expect(bling.revogados).toEqual([]);
  });

  it('troca recusada: não pergunta a empresa e não grava conexão', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = montar();
    const bling = blingFalso(db, {
      token: { status: 400, body: { error: { type: 'invalid_grant', description: 'The authorization code has expired' } } },
    });

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl });
    expect(resultado.outcome).toBe('exchange_failed');
    expect(db.log).not.toContain('fetch empresa');
    expect(db.tables.bling_connections ?? []).toEqual([]);
  });

  it('sem os dados da empresa: revoga a autorização que acabou de nascer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = montar();
    const bling = blingFalso(db, {
      empresa: { status: 403, body: { error: { type: 'insufficient_scope', description: 'escopo' } } },
    });

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl });
    expect(resultado.outcome).toBe('company_failed');
    expect(bling.revogados).toEqual(['refresh-novo']);
    expect(db.tables.bling_connections ?? []).toEqual([]);
  });

  it('a conta já está ligada a OUTRA empresa: recusa, revoga a nova e não mexe na atual', async () => {
    const db = montar({ tables: { bling_connections: [conexaoExistente({})] } });
    const bling = blingFalso(db);

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl });
    expect(resultado.outcome).toBe('company_mismatch');
    expect(bling.revogados).toEqual(['refresh-novo']);
    expect(db.tables.bling_connections).toHaveLength(1);
    expect(db.tables.bling_connections[0].company_id).toBe('empresa-a');
  });

  it('a mesma empresa reconecta por cima, e a conexão volta limpa', async () => {
    const db = montar({
      tables: { bling_connections: [conexaoExistente({ company_id: 'empresa-b', status: 'error' })] },
    });
    const bling = blingFalso(db);

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl, now: () => AGORA });
    expect(resultado).toMatchObject({ outcome: 'connected', reconnected: true });
    expect(db.tables.bling_connections).toHaveLength(1);
    expect(db.tables.bling_connections[0]).toMatchObject({ status: 'connected', consecutive_failures: 0 });
  });

  it('uma conexão REVOGADA de outra empresa pode ser substituída', async () => {
    const db = montar({ tables: { bling_connections: [conexaoExistente({ status: 'revoked' })] } });
    const bling = blingFalso(db);

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl });
    expect(resultado.outcome).toBe('connected');
    expect(db.tables.bling_connections[0].company_id).toBe('empresa-b');
  });

  it('falha ao gravar: revoga no Bling em vez de deixar uma autorização órfã', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = montar({ errors: { 'upsert bling_connections': { code: '23502', message: 'null value' } } });
    const bling = blingFalso(db);

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl });
    expect(resultado.outcome).toBe('save_failed');
    expect(bling.revogados).toEqual(['refresh-novo']);
  });

  it('erro ao reservar o código que não é duplicidade: não chama o Bling', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = montar({ errors: { 'insert bling_oauth_codes': { code: '42P01', message: 'relation does not exist' } } });
    const bling = blingFalso(db);

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl });
    expect(resultado.outcome).toBe('save_failed');
    expect(bling.trocas()).toBe(0);
  });
});

describe('completeAuthorization — uma empresa do Bling, uma conta do CRM (090)', () => {
  it('a empresa já está conectada em OUTRA conta: recusa, revoga a nova e não grava', async () => {
    const db = montar({
      tables: { bling_connections: [conexaoExistente({ id: 'conn-9', account_id: 'outra-conta', company_id: 'empresa-b' })] },
    });
    const bling = blingFalso(db);

    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl });
    expect(resultado.outcome).toBe('company_in_use');
    expect(bling.revogados).toEqual(['refresh-novo']);
    expect(db.tables.bling_connections).toHaveLength(1);
    expect(db.tables.bling_connections[0].account_id).toBe('outra-conta');
  });

  it('conexão REVOGADA da mesma empresa em outra conta não impede', async () => {
    const db = montar({
      tables: {
        bling_connections: [conexaoExistente({ id: 'conn-9', account_id: 'outra-conta', company_id: 'empresa-b', status: 'revoked' })],
      },
    });
    const bling = blingFalso(db);
    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl, now: () => AGORA });
    expect(resultado.outcome).toBe('connected');
  });

  it('a corrida que o índice da 090 pega: também é empresa em uso, e revoga', async () => {
    const db = montar({
      errors: { 'upsert bling_connections': { code: '23505', message: 'idx_bling_connections_company_live' } },
    });
    const bling = blingFalso(db);
    const resultado = await completeAuthorization(ENTRADA, { db: db.client, fetchImpl: bling.impl });
    expect(resultado.outcome).toBe('company_in_use');
    expect(bling.revogados).toEqual(['refresh-novo']);
  });
});
