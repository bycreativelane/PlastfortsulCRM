/**
 * Os erros do Bling, lidos de um jeito só e sem carregar segredo nem dado
 * pessoal para dentro do CRM.
 *
 * ------------------------------------------------------------------
 * TRÊS FORMATOS DE CORPO, NÃO UM
 * ------------------------------------------------------------------
 *
 *   `{ "error": { "type", "message", "description", "fields"?, "limit"?, "period"? } }`
 *       a API v3 e — ao contrário do OAuth padrão — também /oauth/token
 *   `{ "error": "invalid_grant", "error_description": "..." }`
 *       o OAuth padrão, que a documentação não promete mas que não custa ler
 *   `{ "message": "..." }`
 *       o gateway da AWS na frente do Bling, quando a requisição nem chega
 *
 * O `type` do Bling vem em maiúsculas (`VALIDATION_ERROR`) e em minúsculas
 * (`invalid_grant`), e as descrições mudam de texto entre a documentação e a
 * resposta real. Decide-se pelo `type` e pelo status; a descrição só vai
 * para a tela.
 *
 * ------------------------------------------------------------------
 * NADA DE TOKEN, NADA DE DOCUMENTO
 * ------------------------------------------------------------------
 *
 * A mensagem acaba em `last_error`, que a tela de Configurações mostra, e em
 * log. Uma validação de pedido pode citar o CPF do cliente; uma resposta de
 * erro pode ecoar um token. `sanitizeBlingText` troca os dois por marcadores
 * antes de a mensagem sair desta função — é o "nenhum token ou dado pessoal
 * em log" dos critérios de aceite, feito num lugar só.
 */

const LIMITE_DA_MENSAGEM = 300;

export interface BlingFieldError {
  code: number | null;
  message: string;
  element: string | null;
}

export class BlingApiError extends Error {
  constructor(
    /** 0 quando não houve resposta (rede, tempo esgotado). */
    readonly status: number,
    /** O `type` do Bling, ou um nosso: `network`, `timeout`, `invalid_response`. */
    readonly type: string,
    /** Já sanitizado: pode ir para a tela e para o log. */
    readonly detail: string,
    readonly extra: {
      period?: 'second' | 'day';
      limit?: number;
      fields?: BlingFieldError[];
    } = {}
  ) {
    super(`Bling ${status || 'sem resposta'} (${type}): ${detail}`);
  }

  /** Vale tentar de novo daqui a pouco, sem ninguém mexer em nada. */
  get isTransient(): boolean {
    if (this.status === 0) return true;
    if (this.status === 429) return this.extra.period !== 'day';
    return this.status >= 500;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** O access token não serve mais: renovar e repetir uma vez. */
  get isInvalidToken(): boolean {
    return this.status === 401;
  }
}

/**
 * Quando falta a conexão em si — não uma resposta do Bling.
 *
 * `not_configured`  o servidor não tem as três variáveis
 * `not_connected`   a conta não autorizou o Bling
 * `revoked`         o Bling recusou a renovação: é preciso conectar de novo
 * `refresh_busy`    outro processo está renovando e não terminou a tempo
 * `refresh_throttled` a última tentativa foi há menos de um minuto
 * `limiter_unavailable` o banco não respondeu o limitador (082 ausente?)
 */
export type BlingConnectionErrorCode =
  | 'not_configured'
  | 'not_connected'
  | 'revoked'
  | 'refresh_busy'
  | 'refresh_throttled'
  | 'limiter_unavailable';

export class BlingConnectionError extends Error {
  constructor(
    readonly code: BlingConnectionErrorCode,
    readonly detail: string
  ) {
    super(`Bling ${code}: ${detail}`);
  }
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

/** Lê o corpo de uma resposta de erro do Bling, em qualquer dos três formatos. */
export function parseBlingError(status: number, body: string): BlingApiError {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* corpo que não é JSON: fica o genérico */
  }

  const raiz = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<
    string,
    unknown
  >;
  const erro = raiz.error;

  let type = 'unknown';
  let mensagem = '';
  const extra: BlingApiError['extra'] = {};

  if (erro && typeof erro === 'object') {
    const e = erro as Record<string, unknown>;
    type = texto(e.type) ?? type;
    mensagem = texto(e.description) ?? texto(e.message) ?? '';
    if (e.period === 'second' || e.period === 'day') extra.period = e.period;
    const limite = numero(e.limit);
    if (limite !== null) extra.limit = limite;
    if (Array.isArray(e.fields)) {
      extra.fields = e.fields.slice(0, 20).map((campo) => {
        const f = (campo && typeof campo === 'object' ? campo : {}) as Record<
          string,
          unknown
        >;
        return {
          code: numero(f.code),
          message: sanitizeBlingText(texto(f.msg) ?? ''),
          element: texto(f.element),
        };
      });
    }
  } else if (typeof erro === 'string') {
    type = erro;
    mensagem = texto(raiz.error_description) ?? '';
  } else if (texto(raiz.message)) {
    type = 'gateway';
    mensagem = texto(raiz.message) ?? '';
  }

  const detalhe = sanitizeBlingText(mensagem) || (status ? `HTTP ${status}` : 'sem resposta');
  return new BlingApiError(status, type, detalhe, extra);
}

/**
 * Troca por marcadores o que não pode sair do servidor, e corta o tamanho.
 *
 * A ordem importa: o JWT antes do "token longo" (senão sobra `eyJ...` pela
 * metade), e o CNPJ antes do CPF (os dois são números com pontuação, e o
 * CNPJ é o mais comprido).
 */
export function sanitizeBlingText(valor: string): string {
  return valor
    .replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]*/g, '[token]')
    .replace(/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer [token]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
    .replace(/(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITE_DA_MENSAGEM);
}

/** O que a tela e o log podem saber de qualquer falha vinda desta integração. */
export function describeBlingFailure(erro: unknown): { code: string; message: string } {
  if (erro instanceof BlingApiError) {
    return { code: erro.type, message: erro.detail };
  }
  if (erro instanceof BlingConnectionError) {
    return { code: erro.code, message: erro.detail };
  }
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return { code: 'unexpected', message: sanitizeBlingText(mensagem) };
}
