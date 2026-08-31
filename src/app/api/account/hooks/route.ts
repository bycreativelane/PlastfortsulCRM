import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  generateHookToken,
  hashHookToken,
  hookTokenHint,
  HOOK_SCOPES,
} from '@/lib/hooks/inbound';

/**
 * The hooks an account has, and the making of new ones.
 *
 * ------------------------------------------------------------------
 * WHY THE TOKEN IS MINTED HERE AND NOT IN THE BROWSER
 * ------------------------------------------------------------------
 *
 * `crypto.randomBytes` on the server, never `Math.random` or
 * `crypto.getRandomValues` in a component. The token is the credential;
 * generating it client-side would put its entropy at the mercy of
 * whatever the browser does, and would mean the plaintext existed in a
 * place that could be read by any extension on the page.
 *
 * It is returned exactly ONCE, in the response to the POST that created
 * it. After that only the SHA-256 exists, and there is no endpoint that
 * can show it again — the screen says so, and "create another one" is
 * the recovery.
 *
 * ------------------------------------------------------------------
 * ADMIN, ENFORCED TWICE
 * ------------------------------------------------------------------
 *
 * `requireRole('admin')` here and the RLS policy in 058 there. These
 * rows are the security configuration of a public endpoint — the scope
 * and the IP list — so "the UI does not show the button" is not a
 * control.
 */

interface HookBody {
  name?: unknown;
  scopes?: unknown;
  allowed_ips?: unknown;
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { data, error } = await supabase
      .from('webhook_hooks')
      .select(
        'id, name, token_hint, scopes, allowed_ips, enabled, last_used_at, last_error, created_at'
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (error) {
      // Pre-058 the table does not exist. The screen draws "apply the
      // migration" rather than an error nobody can act on.
      return NextResponse.json({ hooks: [], pending: true }, { status: 200 });
    }
    return NextResponse.json({ hooks: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const body = (await request.json().catch(() => ({}))) as HookBody;

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 60) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    }

    // Only the two words the CHECK constraint knows, and `data` is
    // forced on: a hook that can do nothing is a hook somebody will
    // debug for an hour. `messages` only when it was actually asked for.
    const requested = Array.isArray(body.scopes) ? body.scopes : [];
    const scopes = HOOK_SCOPES.filter(
      (scope) => scope === 'data' || requested.includes(scope)
    );

    // A list of addresses typed by a person: trimmed, de-duplicated,
    // capped. Not validated as IPs on purpose — a CIDR or a hostname
    // simply will not match, which is visible on the screen, and
    // refusing them here would be one more thing to get wrong at 2am.
    const allowedIps = Array.isArray(body.allowed_ips)
      ? [
          ...new Set(
            body.allowed_ips
              .filter((v): v is string => typeof v === 'string')
              .map((v) => v.trim())
              .filter(Boolean)
          ),
        ].slice(0, 20)
      : [];

    const token = generateHookToken();

    const { data, error } = await supabase
      .from('webhook_hooks')
      .insert({
        account_id: accountId,
        name,
        token_hash: hashHookToken(token),
        token_hint: hookTokenHint(token),
        scopes,
        allowed_ips: allowedIps,
        created_by: userId,
      })
      .select('id, name, token_hint, scopes, allowed_ips, enabled, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // The one and only time the plaintext leaves the server.
    return NextResponse.json({ hook: data, token }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
