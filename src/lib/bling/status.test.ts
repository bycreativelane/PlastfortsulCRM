import { describe, expect, it } from 'vitest';

import { BLING_STATUS_COLUMNS, isMissingBlingTable, toConnectionView, type BlingStatusRow } from './status';

const LINHA: BlingStatusRow = {
  company_id: 'abc',
  company_name: 'Empresa Exemplo Ltda',
  company_cnpj: '12.345.678/0001-95',
  status: 'connected',
  last_error: null,
  last_error_at: null,
  connected_at: '2026-09-14T12:00:00.000Z',
  connected_by: 'user-1',
  scopes: ['1', '2', '3'],
  access_expires_at: '2026-09-14T17:55:00.000Z',
  refresh_issued_at: '2026-09-14T12:00:00.000Z',
  last_success_at: '2026-09-14T12:00:00.000Z',
  consecutive_failures: 0,
};

describe('o que a tela pode saber', () => {
  it('as colunas lidas não incluem token nenhum', () => {
    // Uma coluna com "token" aqui iria para a resposta da rota — e o que não
    // é lido não vaza por um console.log distraído mais tarde.
    expect(BLING_STATUS_COLUMNS).not.toMatch(/token|rate_|lock/);
  });

  it('a autorização vence 30 dias depois de o refresh token atual ser emitido', () => {
    expect(toConnectionView(LINHA, 'Fulana').refreshExpiresAt).toBe('2026-10-14T12:00:00.000Z');
  });

  it('conta os escopos e leva o nome de quem conectou', () => {
    const view = toConnectionView(LINHA, 'Fulana');
    expect(view.scopeCount).toBe(3);
    expect(view.connectedByName).toBe('Fulana');
    expect(toConnectionView({ ...LINHA, scopes: null }, null).scopeCount).toBe(0);
  });

  it('a visão não tem campo de token', () => {
    const chaves = Object.keys(toConnectionView(LINHA, null));
    expect(chaves.filter((c) => /token/i.test(c))).toEqual([]);
  });
});

describe('isMissingBlingTable', () => {
  it('reconhece a 082 ausente pelos dois códigos', () => {
    expect(isMissingBlingTable({ code: 'PGRST205', message: '' })).toBe(true);
    expect(isMissingBlingTable({ code: '42P01', message: '' })).toBe(true);
    expect(isMissingBlingTable({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
