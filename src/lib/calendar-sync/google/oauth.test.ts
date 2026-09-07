import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authorizeUrl,
  expiresAt,
  GOOGLE_SCOPES,
  googleOAuthConfig,
  isExpired,
  newStateNonce,
  signState,
  verifyState,
} from './oauth';

const CONFIG = {
  clientId: 'id-do-cliente',
  clientSecret: 'segredo',
  redirectUri: 'https://crm.example.com/api/calendar/google/callback',
};

describe('authorizeUrl', () => {
  it('pede offline E consent — sem os dois não vem refresh token', () => {
    const url = new URL(authorizeUrl(CONFIG, 'nonce.mac'));
    expect(url.searchParams.get('access_type')).toBe('offline');
    // Sem isto, a SEGUNDA autorização da mesma conta volta sem refresh
    // token e a conexão morre uma hora depois.
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('leva o state e o redirect', () => {
    const url = new URL(authorizeUrl(CONFIG, 'nonce.mac'));
    expect(url.searchParams.get('state')).toBe('nonce.mac');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('pede os escopos estreitos e não o `calendar` inteiro', () => {
    const url = new URL(authorizeUrl(CONFIG, 's'));
    const scopes = (url.searchParams.get('scope') ?? '').split(' ');
    expect(scopes).toEqual(GOOGLE_SCOPES);
    // O escopo largo daria também o direito de APAGAR agendas inteiras.
    expect(scopes).not.toContain('https://www.googleapis.com/auth/calendar');
  });
});

describe('o state, que é a defesa contra CSRF', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
  });

  it('aceita o par que ele mesmo emitiu', () => {
    const nonce = newStateNonce();
    expect(verifyState(signState(nonce), nonce)).toBe(true);
  });

  it('recusa um state de outro nonce', () => {
    const mine = newStateNonce();
    const theirs = newStateNonce();
    expect(verifyState(signState(theirs), mine)).toBe(false);
  });

  it('recusa assinatura adulterada', () => {
    const nonce = newStateNonce();
    const [value] = signState(nonce).split('.');
    expect(verifyState(`${value}.${'0'.repeat(64)}`, nonce)).toBe(false);
  });

  it('recusa o malformado e o vazio', () => {
    expect(verifyState('', 'n')).toBe(false);
    expect(verifyState('semponto', 'semponto')).toBe(false);
    expect(verifyState('n.', 'n')).toBe(false);
    expect(verifyState(signState('n'), '')).toBe(false);
  });

  it('o nonce não se repete', () => {
    const seen = new Set(Array.from({ length: 50 }, () => newStateNonce()));
    expect(seen.size).toBe(50);
  });
});

describe('googleOAuthConfig', () => {
  it('devolve null quando falta qualquer uma das três', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'x');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'y');
    expect(googleOAuthConfig()).toBeNull();
  });

  it('monta a configuração quando as três estão lá', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'sec');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'uri');
    expect(googleOAuthConfig()).toEqual({
      clientId: 'id',
      clientSecret: 'sec',
      redirectUri: 'uri',
    });
  });
});

describe('validade do access token', () => {
  it('encurta a validade em um minuto', () => {
    const at = Date.parse(expiresAt(3600));
    const semFolga = Date.now() + 3600 * 1000;
    expect(semFolga - at).toBeGreaterThanOrEqual(59_000);
    expect(semFolga - at).toBeLessThanOrEqual(61_000);
  });

  it('trata ausência e lixo como vencido', () => {
    expect(isExpired(null)).toBe(true);
    expect(isExpired(undefined)).toBe(true);
    expect(isExpired('nao é data')).toBe(true);
  });

  it('sabe distinguir passado de futuro', () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });
});
