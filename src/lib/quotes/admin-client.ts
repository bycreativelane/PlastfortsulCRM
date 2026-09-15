import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Lazy, shared service-role client for ONE write: the file links of an
 * archived quote.
 *
 * Mirrors the others next to their domains (`audit/`, `calendar-sync/`,
 * `ai/`, `flows/`, `automations/`) and exists for a reason measured on the
 * test database on 14 September 2026: `deal_quotes` has SELECT and INSERT
 * policies and deliberately no UPDATE (071 — an archived document is not
 * editable). `POST /api/quotes` wrote `pdf_url` with the user's session
 * client, RLS matched zero rows, PostgREST reported no error, and every
 * quote in the archive ended up with NULL links while its PDF sat in the
 * bucket — 9 of 9.
 *
 * The route has already proved, under RLS, that the caller is an agent of
 * the account and that the row is theirs (it inserted it, or read it).
 * This client only fills the four file columns of that row, filtered by
 * id AND account — see `attachQuoteFiles`. It is not a way around the
 * archive's immutability: nothing else in the row is ever written here.
 */
let _adminClient: SupabaseClient | null = null;

export function quotesAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}
