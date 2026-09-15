import { BLING_REFRESH_LIFETIME_DAYS } from './oauth';

/**
 * O que a tela de Configurações › Bling pode saber da conexão.
 *
 * Escolhido à mão, como na Google (`api/calendar/connections`): os dois
 * tokens cifrados não são nem selecionados, e os campos de controle interno
 * (a vez de renovar, o balde de fichas) não saem.
 */

/** As colunas que a rota lê. Nenhuma delas é token. */
export const BLING_STATUS_COLUMNS =
  'company_id, company_name, company_cnpj, status, last_error, last_error_at, connected_at, connected_by, scopes, access_expires_at, refresh_issued_at, last_success_at, consecutive_failures';

export interface BlingStatusRow {
  company_id: string;
  company_name: string | null;
  company_cnpj: string | null;
  status: 'connected' | 'revoked' | 'error';
  last_error: string | null;
  last_error_at: string | null;
  connected_at: string;
  connected_by: string | null;
  scopes: string[] | null;
  access_expires_at: string | null;
  refresh_issued_at: string;
  last_success_at: string | null;
  consecutive_failures: number;
}

export interface BlingConnectionView {
  companyName: string | null;
  companyCnpj: string | null;
  status: 'connected' | 'revoked' | 'error';
  lastError: string | null;
  lastErrorAt: string | null;
  connectedAt: string;
  connectedByName: string | null;
  scopeCount: number;
  accessExpiresAt: string | null;
  refreshIssuedAt: string;
  /**
   * Até quando o refresh token atual vale, pela documentação: 30 dias depois
   * de emitido. Se o Bling girar o refresh token a cada renovação, esta data
   * anda sozinha; se não girar, é o dia em que alguém precisa reconectar.
   */
  refreshExpiresAt: string;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

export function toConnectionView(
  row: BlingStatusRow,
  connectedByName: string | null
): BlingConnectionView {
  const emitido = Date.parse(row.refresh_issued_at);
  const vence = Number.isNaN(emitido)
    ? row.refresh_issued_at
    : new Date(emitido + BLING_REFRESH_LIFETIME_DAYS * 86_400_000).toISOString();

  return {
    companyName: row.company_name,
    companyCnpj: row.company_cnpj,
    status: row.status,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    connectedAt: row.connected_at,
    connectedByName,
    scopeCount: row.scopes?.length ?? 0,
    accessExpiresAt: row.access_expires_at,
    refreshIssuedAt: row.refresh_issued_at,
    refreshExpiresAt: vence,
    lastSuccessAt: row.last_success_at,
    consecutiveFailures: row.consecutive_failures,
  };
}

/** A tabela ainda não existe: a 082 não foi aplicada. */
export function isMissingBlingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /bling_connections/i.test(error.message ?? '')
  );
}
