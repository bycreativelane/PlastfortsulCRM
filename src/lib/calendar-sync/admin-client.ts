import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy, shared service-role client for the calendar sync path.
// Mirrors src/lib/ai/admin-client.ts, src/lib/flows/admin-client.ts and
// src/lib/automations/admin-client.ts — the cron has no `auth.uid()`, and
// `calendar_connections` has RLS enabled with no policy at all (069), so
// the only way in is the service role.
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}
