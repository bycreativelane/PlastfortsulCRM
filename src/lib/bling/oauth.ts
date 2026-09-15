import { BlingApiError, parseBlingError } from './errors';

/**
 * O OAuth do Bling, por `fetch` cru — o mesmo caminho da Google (§1.5 do
 * plano): três endpoints não justificam uma dependência.
 *
 * ------------------------------------------------------------------
 * O CONTRATO, CONFERIDO NA DOCUMENTAÇÃO OFICIAL EM 14/09/2026
 * ------------------------------------------------------------------
 *
 * - A autorização é em `www.bling.com.br`; token e revogação, em
 *   `api.bling.com.br`. O `www` recusa chamada de API com 403, e a variante
 *   sem `/Api/v3` que aparece num exemplo da documentação não passa do gateway.
 * - `redirect_uri` e `scope` NÃO vão na autorização: o Bling usa os do
 *   cadastro do aplicativo mesmo que se mande outros. Mudar os escopos no
 *   cadastro revoga todos os usuários.
 * - Credenciais só no `Authorization: Basic`; no corpo "não é permitido".
 * - `enable-jwt: 1` na troca, na renovação e em toda chamada: sem ele o
 *   token é o opaco, que a documentação chama de descontinuado sem data.
 * - O código vale UM minuto e UMA vez. Reusar revoga o usuário — por isso o
 *   callback grava o hash do código antes de trocar (082).
 * - O refresh token vale 30 dias. Se ele muda a cada renovação NÃO é
 *   documentado: grava-se sempre o que voltar.
 */

export const BLING_AUTHORIZE_URL = 'https://www.bling.com.br/Api/v3/oauth/authorize';
export const BLING_TOKEN_URL = 'https://api.bling.com.br/Api/v3/oauth/token';
export const BLING_REVOKE_URL = 'https://api.bling.com.br/Api/v3/oauth/revoke';

/** O cookie que segura o nonce entre a ida ao Bling e a volta. */
export const BLING_STATE_COOKIE = 'bling_oauth_state';

/**
 * Dez minutos, e não os noventa segundos da Google.
 *
 * Quem clica em "Conectar" normalmente ainda não está logado no Bling: entra
 * com usuário e senha, às vezes com o segundo fator, e só então vê o
 * consentimento. Um cookie de noventa segundos morre no meio disso, e a volta
 * cai em "a autorização expirou" sem que ninguém tenha demorado de propósito.
 */
export const BLING_STATE_MAX_AGE = 600;

/**
 * Para onde o callback devolve a pessoa. É `sectionHref('bling')` — escrito
 * aqui para a rota não importar o registro de seções, que traz ícones e
 * componentes; um teste confere que os dois continuam iguais. A Google usa
 * `?section=`, que a página não lê (§10 do plano), e não se copia.
 */
export const BLING_SETTINGS_PATH = '/settings?tab=bling';

/** Validade do refresh token, pela documentação. */
export const BLING_REFRESH_LIFETIME_DAYS = 30;

const TOKEN_TIMEOUT_MS = 15_000;
const REVOKE_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface BlingOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Lê a configuração do ambiente, ou `null` se faltar qualquer uma das três.
 *
 * `BLING_OAUTH_REDIRECT_URI` não vai em requisição nenhuma — o Bling usa o
 * link do cadastro. Ela é exigida mesmo assim: é a prova de que quem
 * configurou o servidor cadastrou o aplicativo apontando para ele.
 */
export function blingOAuthConfig(): BlingOAuthConfig | null {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const redirectUri = process.env.BLING_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function authorizeUrl(config: BlingOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    state,
  });
  return `${BLING_AUTHORIZE_URL}?${params.toString()}`;
}

export interface BlingTokens {
  accessToken: string;
  refreshToken: string;
  /** Segundos. */
  expiresIn: number;
  /** Os ids numéricos de `scope`. */
  scopes: string[];
}

function basicAuth(config: BlingOAuthConfig): string {
  const par = `${config.clientId}:${config.clientSecret}`;
  return `Basic ${Buffer.from(par, 'utf8').toString('base64')}`;
}

/** Falha sem resposta: o tempo esgotado e a rede são coisas diferentes na tela. */
export function networkError(erro: unknown): BlingApiError {
  if (erro instanceof DOMException && erro.name === 'TimeoutError') {
    return new BlingApiError(0, 'timeout', 'o Bling não respondeu a tempo');
  }
  return new BlingApiError(0, 'network', 'não foi possível falar com o Bling');
}

export function exchangeCode(
  config: BlingOAuthConfig,
  code: string,
  fetchImpl: FetchLike = fetch
): Promise<BlingTokens> {
  return postToken(config, { grant_type: 'authorization_code', code }, fetchImpl);
}

export function refreshTokens(
  config: BlingOAuthConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch
): Promise<BlingTokens> {
  return postToken(
    config,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetchImpl
  );
}

async function postToken(
  config: BlingOAuthConfig,
  body: Record<string, string>,
  fetchImpl: FetchLike
): Promise<BlingTokens> {
  let response: Response;
  try {
    response = await fetchImpl(BLING_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Literal assim nos exemplos da documentação.
        Accept: '1.0',
        Authorization: basicAuth(config),
        'enable-jwt': '1',
      },
      body: new URLSearchParams(body).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (erro) {
    throw networkError(erro);
  }

  const text = await response.text();
  if (!response.ok) throw parseBlingError(response.status, text);
  return parseTokens(response.status, text);
}

/**
 * Confere a resposta do token antes de alguém gravá-la.
 *
 * Sem `refresh_token` a conexão morreria na primeira expiração, seis horas
 * depois de parecer pronta — recusar agora é melhor que descobrir amanhã.
 * Sem `expires_in` válido, supõe-se uma hora: renovar cedo custa uma chamada,
 * confiar num token vencido custa um 401 que parece revogação.
 */
export function parseTokens(status: number, text: string): BlingTokens {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BlingApiError(status, 'invalid_response', 'a resposta do token não é JSON');
  }

  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : '';
  if (!accessToken || !refreshToken) {
    throw new BlingApiError(
      status,
      'invalid_response',
      'a resposta do token veio sem access_token ou refresh_token'
    );
  }

  const expiresIn = Number(data.expires_in);
  return {
    accessToken,
    refreshToken,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
    scopes:
      typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : [],
  };
}

/**
 * Revoga um token no Bling. Melhor esforço: devolve se deu certo, nunca lança.
 *
 * Quem desconecta quer que o CRM pare de acessar a conta, e isso acontece
 * apagando a linha de qualquer jeito. Revogar é o que tira a autorização
 * também do lado do Bling — importante, mas não pode segurar a desconexão
 * quando o Bling estiver fora do ar. O corpo da resposta de sucesso não é
 * documentado; vale o status.
 */
export async function revokeToken(
  config: BlingOAuthConfig,
  token: string,
  hint: 'access_token' | 'refresh_token',
  fetchImpl: FetchLike = fetch
): Promise<boolean> {
  try {
    const response = await fetchImpl(BLING_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuth(config),
      },
      body: new URLSearchParams({ token, token_type_hint: hint }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Quando o access token deixa de valer, com cinco minutos de folga.
 *
 * A folga existe porque o token é conferido ANTES da chamada, e a chamada
 * pode esperar o limitador: um token com dez segundos de vida passa na
 * conferência e vence na fila, e o 401 que volta parece revogação.
 */
export function accessExpiresAt(expiresIn: number, now = Date.now()): string {
  const folga = Math.min(300, Math.floor(expiresIn / 2));
  return new Date(now + (expiresIn - folga) * 1000).toISOString();
}

export function isAccessValid(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return !Number.isNaN(at) && at > now;
}
