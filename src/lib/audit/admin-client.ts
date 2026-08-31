import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Lazy, shared service-role client for writing the audit log.
 *
 * Mirrors the three next to it (`ai/`, `flows/`, `automations/`) and
 * exists for the same reason: `account_audit_log` has no client INSERT
 * policy (migration 050), because a client that could insert freely
 * could also insert convincingly. The routes that DO the auditable
 * things already hold an RLS-scoped client for the work itself; this is
 * the second one, used only to write the footnote.
 */
let _adminClient: SupabaseClient | null = null;

export function auditAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}
