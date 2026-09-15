import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy, shared service-role client for the Bling integration.
// Mirrors src/lib/calendar-sync/admin-client.ts: `bling_connections` and
// `bling_oauth_codes` have RLS enabled with no policy at all (082), and the
// limiter and refresh-lease functions are granted to service_role only.
let _adminClient: SupabaseClient | null = null;

export function blingAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}
