import crypto from 'crypto';

/**
 * O OAuth da Google, por `fetch` cru.
 *
 * Decisão §D1 do plano: `googleapis` são dezenas de megabytes para usar
 * três endpoints. O repositório já fala com a Graph API da Meta assim
 * (`lib/whatsapp/meta-api.ts`), e a Calendar API não é mais difícil.
 * Nenhuma dependência nova, e a imagem Docker não engorda.
 *
 * ------------------------------------------------------------------
 * `access_type=offline` E `prompt=consent`, OS DOIS
 * ------------------------------------------------------------------
 *
 * Sem `access_type=offline` não vem refresh token nenhum. E sem
 * `prompt=consent` ele vem só na PRIMEIRA autorização daquela conta — na
 * segunda a Google devolve apenas o access token, de uma hora, e a conexão
 * morre silenciosamente sessenta minutos depois de alguém reconectar.
 *
 * Esse é o modo de falha mais caro desta integração porque parece
 * intermitente: funciona no dia em que se conecta, quebra no dia seguinte,
 * e volta a funcionar quando alguém reconecta.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * Os dois escopos mais estreitos que resolvem o pedido.
 *
 * `calendar.readonly` lista as agendas e lê eventos; `calendar.events`
 * cria e edita os do CRM. O escopo largo (`calendar`) daria também o
 * direito de APAGAR agendas inteiras, que nada aqui precisa.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Lê a configuração do ambiente, ou explica o que falta.
 *
 * Devolve `null` em vez de lançar: a tela de Configurações precisa dizer
 * "a integração não está configurada neste servidor" sem derrubar a
 * requisição, e uma instância que nunca vai usar a Google não deve nem
 * saber que essas variáveis existem.
 */
export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

// ------------------------------------------------------------
// O `state`, que é a defesa contra CSRF
// ------------------------------------------------------------

/**
 * Um nonce assinado, e por que ele não é opcional.
 *
 * Sem conferir o `state`, o callback aceita uma autorização que OUTRO site
 * iniciou: alguém induz um admin logado a abrir um endereço de callback com
 * um `code` da conta Google do atacante, e o CRM da vítima passa a publicar
 * as tarefas da empresa na agenda de quem atacou. O ataque é silencioso —
 * a tela diz "conectado" e está dizendo a verdade, só que à conta errada.
 *
 * O valor vai no parâmetro `state` e o mesmo nonce vai num cookie
 * `httpOnly` de vida curta; o callback exige que os dois batam. Assinado
 * com `ENCRYPTION_KEY`, que já existe, em vez de guardar estado no banco:
 * um nonce que vive noventa segundos não merece uma tabela.
 */
export function signState(nonce: string): string {
  const key = process.env.ENCRYPTION_KEY ?? '';
  const mac = crypto.createHmac('sha256', key).update(nonce).digest('hex');
  return `${nonce}.${mac}`;
}

export function newStateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Confere o `state` do retorno contra o nonce guardado no cookie.
 *
 * `timingSafeEqual` e não `===`: a comparação de um MAC byte a byte com
 * saída antecipada vaza, pelo tempo, quantos bytes iniciais estavam
 * certos. É pouco explorável aqui, mas comparar MAC assim é o hábito que
 * evita a próxima vez em que for explorável.
 */
export function verifyState(state: string, cookieNonce: string): boolean {
  if (!state || !cookieNonce) return false;
  const [nonce, mac] = state.split('.');
  if (!nonce || !mac) return false;
  if (nonce !== cookieNonce) return false;

  const expected = signState(nonce).split('.')[1];
  const a = Buffer.from(mac, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------
// O fluxo
// ------------------------------------------------------------

export function authorizeUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string
): Promise<TokenResponse> {
  return postToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code,
  });
}

export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string
): Promise<TokenResponse> {
  return postToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    // A mensagem da Google entra no erro, mas o corpo inteiro não: ele
    // pode carregar o `client_secret` de volta em algumas respostas de
    // erro, e isto acaba num `last_error` que a tela mostra.
    let detail = 'unknown_error';
    try {
      const parsed = JSON.parse(text) as {
        error?: string;
        error_description?: string;
      };
      detail = parsed.error_description || parsed.error || detail;
    } catch {
      /* resposta não-JSON: fica o genérico */
    }
    throw new Error(`Google OAuth ${response.status}: ${detail}`);
  }

  return JSON.parse(text) as TokenResponse;
}

/** O e-mail da conta que autorizou — o que a tela mostra como "conectado a". */
export async function fetchAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Google userinfo ${response.status}`);
  const data = (await response.json()) as { email?: string };
  if (!data.email) throw new Error('Google userinfo sem e-mail');
  return data.email.toLowerCase();
}

/**
 * Quando o access token expira, com um minuto de folga.
 *
 * A folga existe porque o token é conferido ANTES da chamada e a chamada
 * leva tempo: um token com dois segundos de vida passa na conferência e
 * expira no meio do voo, e o erro que volta é um 401 que parece revogação.
 */
export function expiresAt(expiresIn: number): string {
  return new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();
}

export function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return true;
  const at = Date.parse(iso);
  return Number.isNaN(at) || at <= Date.now();
}
