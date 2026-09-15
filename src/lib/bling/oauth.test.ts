import { afterEach, describe, expect, it, vi } from 'vitest';

import { sectionHref } from '@/components/settings/settings-sections';

import { BlingApiError } from './errors';
import {
  accessExpiresAt,
  authorizeUrl,
  BLING_SETTINGS_PATH,
  blingOAuthConfig,
  exchangeCode,
  isAccessValid,
  parseTokens,
  refreshTokens,
  revokeToken,
  type FetchLike,
} from './oauth';

const CONFIG = {
  clientId: 'id-do-app',
  clientSecret: 'segredo-do-app',
  redirectUri: 'https://crm.example.com/api/bling/oauth/callback',
};

const TOKENS = {
  access_token: 'access-novo',
  expires_in: 21600,
  token_type: 'Bearer',
  scope: '98309 318257570 5862218180',
  refresh_token: 'refresh-novo',
};

/** Um fetch que grava a chamada e responde o que mandarem. */
function fetchQueResponde(status: number, body: unknown) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  const impl: FetchLike = async (url, init) => {
    chamadas.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { impl, chamadas };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('blingOAuthConfig', () => {
  it('null quando falta qualquer uma das três — a integração fica dormente', () => {
    vi.stubEnv('BLING_CLIENT_ID', 'x');
    vi.stubEnv('BLING_CLIENT_SECRET', '');
    vi.stubEnv('BLING_OAUTH_REDIRECT_URI', 'y');
    expect(blingOAuthConfig()).toBeNull();
  });

  it('monta quando as três estão lá', () => {
    vi.stubEnv('BLING_CLIENT_ID', 'id');
    vi.stubEnv('BLING_CLIENT_SECRET', 'sec');
    vi.stubEnv('BLING_OAUTH_REDIRECT_URI', 'uri');
    expect(blingOAuthConfig()).toEqual({ clientId: 'id', clientSecret: 'sec', redirectUri: 'uri' });
  });
});

describe('authorizeUrl', () => {
  it('vai para www.bling.com.br com response_type, client_id e state', () => {
    const url = new URL(authorizeUrl(CONFIG, 'nonce.mac'));
    expect(url.origin).toBe('https://www.bling.com.br');
    expect(url.pathname).toBe('/Api/v3/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('id-do-app');
    expect(url.searchParams.get('state')).toBe('nonce.mac');
  });

  it('não manda redirect_uri nem scope: o Bling usa os do cadastro', () => {
    const url = new URL(authorizeUrl(CONFIG, 's'));
    expect(url.searchParams.has('redirect_uri')).toBe(false);
    expect(url.searchParams.has('scope')).toBe(false);
  });
});

describe('troca do código e renovação', () => {
  it('POST em api.bling.com.br/Api/v3/oauth/token, com Basic e enable-jwt', async () => {
    const { impl, chamadas } = fetchQueResponde(200, TOKENS);
    await exchangeCode(CONFIG, 'codigo-123', impl);

    expect(chamadas).toHaveLength(1);
    const { url, init } = chamadas[0];
    // O `www` recusa chamada de API, e a variante sem /Api/v3 não passa do gateway.
    expect(url).toBe('https://api.bling.com.br/Api/v3/oauth/token');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers['enable-jwt']).toBe('1');
    expect(headers.Accept).toBe('1.0');
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('id-do-app:segredo-do-app').toString('base64')}`
    );
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeDefined();

    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'authorization_code', code: 'codigo-123' });
  });

  it('as credenciais nunca vão no corpo', async () => {
    const { impl, chamadas } = fetchQueResponde(200, TOKENS);
    await refreshTokens(CONFIG, 'refresh-velho', impl);
    const body = String(chamadas[0].init.body);
    expect(body).not.toContain('segredo');
    expect(body).not.toContain('id-do-app');
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-velho',
    });
  });

  it('devolve os tokens com os escopos separados', async () => {
    const { impl } = fetchQueResponde(200, TOKENS);
    expect(await exchangeCode(CONFIG, 'c', impl)).toEqual({
      accessToken: 'access-novo',
      refreshToken: 'refresh-novo',
      expiresIn: 21600,
      scopes: ['98309', '318257570', '5862218180'],
    });
  });

  it('erro do Bling vira BlingApiError com o type', async () => {
    const { impl } = fetchQueResponde(400, {
      error: {
        type: 'VALIDATION_ERROR',
        message: 'Invalid authorization code',
        description: 'This authorization code has already been used, for security reasons the user has been revoked.',
      },
    });
    const erro = await exchangeCode(CONFIG, 'c', impl).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BlingApiError);
    expect((erro as BlingApiError).type).toBe('VALIDATION_ERROR');
  });

  it('tempo esgotado e rede caída são falhas sem resposta, e passageiras', async () => {
    const tempo: FetchLike = async () => {
      throw new DOMException('timeout', 'TimeoutError');
    };
    const rede: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const e1 = (await refreshTokens(CONFIG, 'r', tempo).catch((e: unknown) => e)) as BlingApiError;
    const e2 = (await refreshTokens(CONFIG, 'r', rede).catch((e: unknown) => e)) as BlingApiError;
    expect([e1.status, e1.type, e1.isTransient]).toEqual([0, 'timeout', true]);
    expect([e2.status, e2.type, e2.isTransient]).toEqual([0, 'network', true]);
  });
});

describe('parseTokens', () => {
  it('sem refresh_token, recusa — a conexão morreria em seis horas', () => {
    const { refresh_token: _, ...semRefresh } = TOKENS;
    expect(() => parseTokens(200, JSON.stringify(semRefresh))).toThrow(BlingApiError);
  });

  it('expires_in ausente vira uma hora, para renovar cedo', () => {
    const { expires_in: _, ...semValidade } = TOKENS;
    expect(parseTokens(200, JSON.stringify(semValidade)).expiresIn).toBe(3600);
  });

  it('resposta que não é JSON', () => {
    expect(() => parseTokens(200, 'ok')).toThrow(BlingApiError);
  });
});

describe('revokeToken', () => {
  it('POST com Basic, token e dica; true só com 2xx', async () => {
    const { impl, chamadas } = fetchQueResponde(200, '');
    expect(await revokeToken(CONFIG, 'refresh-x', 'refresh_token', impl)).toBe(true);
    const { url, init } = chamadas[0];
    expect(url).toBe('https://api.bling.com.br/Api/v3/oauth/revoke');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      token: 'refresh-x',
      token_type_hint: 'refresh_token',
    });

    const { impl: recusa } = fetchQueResponde(400, { error: { type: 'x' } });
    expect(await revokeToken(CONFIG, 't', 'access_token', recusa)).toBe(false);
  });

  it('nunca lança: a desconexão não pode depender do Bling estar no ar', async () => {
    const quebra: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await revokeToken(CONFIG, 't', 'access_token', quebra)).toBe(false);
  });
});

describe('validade do access token', () => {
  it('seis horas viram seis horas menos cinco minutos', () => {
    const agora = Date.parse('2026-09-14T12:00:00Z');
    expect(accessExpiresAt(21600, agora)).toBe('2026-09-14T17:55:00.000Z');
  });

  it('um token curto não fica com folga maior que a metade da vida', () => {
    const agora = Date.parse('2026-09-14T12:00:00Z');
    expect(accessExpiresAt(60, agora)).toBe('2026-09-14T12:00:30.000Z');
  });

  it('ausente, lixo e passado não valem', () => {
    const agora = Date.parse('2026-09-14T12:00:00Z');
    expect(isAccessValid(null, agora)).toBe(false);
    expect(isAccessValid('não é data', agora)).toBe(false);
    expect(isAccessValid('2026-09-14T11:59:59Z', agora)).toBe(false);
    expect(isAccessValid('2026-09-14T12:00:01Z', agora)).toBe(true);
  });
});

describe('para onde o callback devolve', () => {
  it('é a mesma URL que o registro de seções monta — e usa ?tab=, não ?section=', () => {
    expect(BLING_SETTINGS_PATH).toBe(sectionHref('bling'));
  });
});
