// ============================================================
// The vocabulary of the audit log.
//
// `account_audit_log.action` is TEXT with no enum behind it — see
// migration 050 for why: an enum would make every new kind of event a
// migration, and the failure mode of that friction is not "we migrate
// carefully", it is "we stop logging things".
//
// So the closed set lives here, where adding one costs a line. Anything
// this file does not know still STORES fine and still renders — as its
// raw dotted key rather than as a sentence. A log that shows
// `member.something_new` is doing its job; a log that drops the row
// because nobody added a label is not.
// ============================================================

/** The dotted keys this app writes. Ordered by area. */
export const AUDIT_ACTIONS = [
  // Sessions — written by the browser through `record_sign_in()`.
  'session.signed_in',

  // Membership.
  'member.invited',
  'member.invite_revoked',
  'member.joined',
  'member.role_changed',
  'member.permissions_changed',
  'member.removed',
  'account.ownership_transferred',

  // Keys and integrations.
  'api_key.created',
  'api_key.revoked',
  'ai.config_updated',
  'whatsapp.config_updated',
  'bling.connected',
  'bling.disconnected',
  'bling.mapping_updated',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * What the row is about, for the icon and the grouping filter. Kept as
 * a derivation of the action rather than a stored column: the prefix
 * already carries it, and two fields that must agree are two fields that
 * eventually will not.
 */
export type AuditArea = 'session' | 'member' | 'account' | 'key' | 'integration';

/**
 * Which action prefixes belong to each area — the one table both
 * `auditArea` (a row already in hand) and the audit route's SQL filter
 * (`action.like.<prefix>*`) read.
 *
 * It lived twice, once here as `if`s and once in the route, and adding
 * `bling.` would have meant remembering both: forget the route and the
 * Integrations chip silently returns no Bling rows. `events.test.ts`
 * checks every action lands in exactly one area.
 */
export const AUDIT_AREA_PREFIXES: Record<AuditArea, string[]> = {
  session: ['session.'],
  member: ['member.'],
  account: ['account.'],
  key: ['api_key.'],
  integration: ['ai.', 'whatsapp.', 'bling.'],
};

export function auditArea(action: string): AuditArea {
  for (const [area, prefixes] of Object.entries(AUDIT_AREA_PREFIXES)) {
    if (prefixes.some((p) => action.startsWith(p))) return area as AuditArea;
  }
  return 'account';
}

/** One row, as the API hands it to the panel. */
export interface AuditEntry {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_label: string | null;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * A value from `metadata.changes`, readable: text as is, numbers, yes/no,
 * lists. The panel used to read only text — turning Bling orders on (`true`)
 * showed as "— → —", the audit log saying nothing had changed.
 */
export function auditValue(value: unknown, labels: { yes: string; no: string }): string {
  if (typeof value === 'string') return value || '—';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? labels.yes : labels.no;
  if (Array.isArray(value)) {
    const parts = value.map((v) => auditValue(v, labels)).filter((v) => v !== '—');
    return parts.length ? parts.join(', ') : '—';
  }
  return '—';
}
