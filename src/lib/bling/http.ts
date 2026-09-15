import { BlingApiError, parseBlingError } from './errors';
import { networkError, type FetchLike } from './oauth';

/**
 * Uma chamada à API v3 com um access token na mão — e só isso.
 *
 * Não renova token, não passa pelo limitador e não grava nada: é o degrau
 * de baixo, que o callback usa uma vez antes de a conexão existir e que
 * `client.ts` usa depois de resolver as três coisas. Devolve o erro em vez
 * de lançar, porque quem chama decide o que um 401 quer dizer.
 */

export const BLING_API_BASE = 'https://api.bling.com.br/Api/v3';

const API_TIMEOUT_MS = 20_000;

export interface BlingCall {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

export type BlingResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; error: BlingApiError };

export async function blingFetch<T>(
  accessToken: string,
  path: string,
  call: BlingCall = {},
  fetchImpl: FetchLike = fetch
): Promise<BlingResult<T>> {
  if (!path.startsWith('/')) {
    throw new Error(`blingFetch: o caminho precisa começar com "/" (${path})`);
  }

  const url = new URL(`${BLING_API_BASE}${path}`);
  for (const [chave, valor] of Object.entries(call.query ?? {})) {
    // Parâmetro ausente não vai como "undefined": a listagem de produtos,
    // por exemplo, muda de resultado conforme o que é mandado (§1.6).
    if (valor !== undefined && valor !== null) url.searchParams.set(chave, String(valor));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'enable-jwt': '1',
  };
  if (call.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: call.method ?? 'GET',
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      // Um redirecionamento aqui nunca é legítimo, e segui-lo levaria o
      // cabeçalho com o token para onde o Location mandar.
      redirect: 'manual',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (erro) {
    return { ok: false, error: networkError(erro) };
  }

  const text = await response.text();
  if (!response.ok) {
    return { ok: false, error: parseBlingError(response.status, text) };
  }
  if (!text) return { ok: true, status: response.status, data: null as T };

  try {
    return { ok: true, status: response.status, data: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      error: new BlingApiError(response.status, 'invalid_response', 'a resposta não é JSON'),
    };
  }
}

export interface BlingCompany {
  id: string;
  name: string | null;
  cnpj: string | null;
}

/** `GET /empresas/me/dados-basicos`: `{ data: { id, nome, cnpj, email, dataContrato } }`. */
export function parseCompany(body: unknown): BlingCompany | null {
  const data =
    body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  // O id é uma string hexadecimal; um número aqui seria outro contrato.
  if (typeof d.id !== 'string' || !d.id.trim()) return null;
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { id: d.id.trim(), name: texto(d.nome), cnpj: texto(d.cnpj) };
}
