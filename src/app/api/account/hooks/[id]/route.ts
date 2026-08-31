import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { HOOK_SCOPES } from '@/lib/hooks/inbound';

/**
 * Change or revoke one hook.
 *
 * REVOKING IS A DELETE, not a flag, and the difference matters: a
 * deleted row cannot be matched by `token_hash`, so the URL is dead the
 * instant the request returns. `enabled = false` is the softer gesture
 * for "pause while I fix the flow", and the screen offers both because
 * they answer different questions — "this leaked" and "this is noisy
 * right now".
 *
 * The deliveries go with it (ON DELETE CASCADE in 058): they are the
 * payloads that hook received, and keeping the PII of a hook nobody
 * owns any more would be the opposite of the retention rule the table
 * was built with.
 */

interface PatchBody {
  name?: unknown;
  scopes?: unknown;
  allowed_ips?: unknown;
  enabled?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as PatchBody;

    const patch: Record<string, unknown> = {};

    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name || name.length > 60) {
        return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
      }
      patch.name = name;
    }

    if (Array.isArray(body.scopes)) {
      const requested = body.scopes;
      patch.scopes = HOOK_SCOPES.filter(
        (scope) => scope === 'data' || requested.includes(scope)
      );
    }

    if (Array.isArray(body.allowed_ips)) {
      patch.allowed_ips = [
        ...new Set(
          body.allowed_ips
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter(Boolean)
        ),
      ].slice(0, 20);
    }

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
    }

    // `account_id` in the filter as well as the RLS policy. The policy
    // is the control; this is what makes a mistake in it fail closed
    // rather than silently write somebody else's row.
    const { data, error } = await supabase
      .from('webhook_hooks')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(
        'id, name, token_hint, scopes, allowed_ips, enabled, last_used_at, last_error, created_at'
      )
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({ hook: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;

    const { error } = await supabase
      .from('webhook_hooks')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
