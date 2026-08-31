// ============================================================
// PUT /api/account/members/[userId]/permissions
//
// Sets one member's exceptions over their role — the write half of
// Configurações › Acesso e permissões. Admin and up.
//
// The whole map is replaced, not merged. A PATCH-style merge would make
// "turn this back to the role default" impossible to express: the client
// would have to send a key meaning "delete this key", and the absence of
// a key already means exactly that. So the panel sends what the member
// should end up with, which is also what it is showing on screen.
//
// THE WRITE IS AN RPC, and that is not a style choice. `profiles_update`
// (017) is `auth.uid() = user_id` on both halves — a member may update
// their own row and nobody else's — so a plain PATCH from an admin
// against a colleague's row matches ZERO ROWS and returns no error. This
// screen would say "salvo" and change nothing, forever, and the only way
// to notice would be for somebody to reload and see the switch back where
// it was. `set_member_permissions` (migration 050) is SECURITY DEFINER
// and does the real authorisation, exactly like `set_member_role` (018).
//
// Everything checked here is checked again in there. The duplication buys
// a sentence instead of a SQLSTATE for the caller; the RPC is what makes
// it true.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  CAPABILITIES,
  canBeGranted,
  isCapability,
  parseOverrides,
  roleGrants,
  type Capability,
  type PermissionOverrides,
} from '@/lib/auth/capabilities';
import { isAccountRole } from '@/lib/auth/roles';
import { auditAdmin } from '@/lib/audit/admin-client';
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:memberPermissions:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: 'You cannot change your own permissions' },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      overrides?: unknown;
    } | null;

    if (
      !body ||
      typeof body.overrides !== 'object' ||
      body.overrides === null ||
      Array.isArray(body.overrides)
    ) {
      return NextResponse.json(
        { error: "'overrides' must be an object of capability → boolean" },
        { status: 400 }
      );
    }

    // Reject rather than silently drop. `parseOverrides` is the tolerant
    // reader for data already in the column — an unknown key there is a
    // capability that used to exist. On the way IN it is a typo or a
    // client that is out of date, and accepting the request while
    // discarding half of it is how somebody comes back tomorrow asking
    // why the switch did not stick.
    for (const [key, value] of Object.entries(body.overrides)) {
      if (!isCapability(key)) {
        return NextResponse.json(
          { error: `Unknown capability: ${key}` },
          { status: 400 }
        );
      }
      if (typeof value !== 'boolean') {
        return NextResponse.json(
          { error: `Capability '${key}' must be true or false` },
          { status: 400 }
        );
      }
    }

    // The target has to be in this account. RLS on `profiles` scopes the
    // read, so a uid from another account simply is not found — which is
    // the right answer and also the one that leaks nothing about whether
    // it exists.
    const { data: target, error: targetError } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name, email, account_role')
      .eq('account_id', ctx.accountId)
      .eq('user_id', userId)
      .maybeSingle();

    if (targetError) {
      console.error('[members permissions] target lookup failed:', targetError);
      return NextResponse.json(
        { error: 'Failed to load the member' },
        { status: 500 }
      );
    }
    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const targetRole = isAccountRole(target.account_role)
      ? target.account_role
      : null;
    if (!targetRole) {
      return NextResponse.json(
        { error: 'That member has no usable role' },
        { status: 400 }
      );
    }
    if (targetRole === 'owner') {
      // The owner is the account. A screen that can take Configurações
      // away from them is a screen that can lock everybody out, and the
      // recovery for that is a database console.
      return NextResponse.json(
        { error: "The owner's permissions cannot be restricted" },
        { status: 403 }
      );
    }

    // Two normalisations, both of which make the stored map mean exactly
    // what it says:
    //
    //   · An override equal to what the role already answers is dropped.
    //     Storing it would freeze this member's capability against a
    //     future role change — promote them to admin and they would
    //     still be missing Relatórios, because somebody had once written
    //     down the answer their old role happened to give.
    //
    //   · A GRANT for a capability the database enforces is refused. The
    //     interface would draw the control and the request behind it
    //     would fail; see `canBeGranted`.
    const requested = parseOverrides(body.overrides);
    const overrides: PermissionOverrides = {};
    for (const [key, value] of Object.entries(requested) as Array<
      [Capability, boolean]
    >) {
      if (value === roleGrants(targetRole, key)) continue;
      if (value && !canBeGranted(targetRole, key)) {
        return NextResponse.json(
          {
            error: `'${key}' cannot be granted above the ${targetRole} role — the database enforces it too. Change their role instead.`,
            capability: key,
            minRole: CAPABILITIES[key].minRole,
          },
          { status: 400 }
        );
      }
      overrides[key] = value;
    }

    const { error } = await ctx.supabase.rpc('set_member_permissions', {
      p_user_id: userId,
      p_overrides: overrides,
    });

    if (error) {
      // PGRST202 is "no such function" — the pre-050 case. The column is
      // not there either, so `isUnknownColumn` covers the other shape of
      // the same fact.
      if (error.code === 'PGRST202' || isUnknownColumn(error)) {
        return NextResponse.json(
          { error: 'Migration 050 has not been applied yet.', pending: true },
          { status: 409 }
        );
      }
      // The RPC's own refusals, mapped the way the members route maps
      // 018's: 42501 is "you may not", 22023 is "that is not a thing".
      if (error.code === '42501') {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.code === '22023') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error('[members permissions] update failed:', error);
      return NextResponse.json(
        { error: 'Failed to save permissions' },
        { status: 500 }
      );
    }

    const db = auditAdmin();
    await logAuditEvent(db, {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
      action: 'member.permissions_changed',
      targetType: 'member',
      targetId: userId,
      targetLabel: target.full_name || target.email || null,
      metadata: { overrides, role: targetRole },
    });

    return NextResponse.json({ ok: true, overrides });
  } catch (err) {
    return toErrorResponse(err);
  }
}
