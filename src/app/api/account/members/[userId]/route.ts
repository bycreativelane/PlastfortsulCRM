// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// Both delegate to SECURITY DEFINER RPCs from migration 018:
//   - set_member_role(p_user_id, p_new_role)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account, target can't be the
// owner, can't be self. The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import { auditAdmin } from "@/lib/audit/admin-client";
import { auditActorLabel, logAuditEvent } from "@/lib/audit/log";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

/**
 * Who the act was done TO, in words.
 *
 * Read BEFORE the RPC in both handlers below, and that ordering is the
 * point rather than an accident: `remove_account_member` moves the row
 * out of this account, so a label fetched afterwards would come back
 * empty for exactly the event that most needs a name on it.
 */
async function targetLabel(
  supabase: Awaited<ReturnType<typeof requireRole>>["supabase"],
  accountId: string,
  userId: string,
): Promise<{ label: string | null; role: string | null }> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email, account_role")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as {
    full_name?: string | null;
    email?: string | null;
    account_role?: string | null;
  } | null;
  return {
    label: row?.full_name || row?.email || null,
    role: row?.account_role ?? null,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown }
      | null;
    const role = body?.role;

    if (!isAccountRole(role)) {
      return NextResponse.json(
        { error: "'role' must be one of owner, admin, agent, viewer" },
        { status: 400 },
      );
    }

    // The RPC blocks promotion to / demotion from owner, but
    // surface the friendlier 400 before crossing the wire too.
    if (role === "owner") {
      return NextResponse.json(
        {
          error:
            "Use POST /api/account/transfer-ownership to promote a member to owner",
        },
        { status: 400 },
      );
    }

    const before = await targetLabel(ctx.supabase, ctx.accountId, userId);

    const { error } = await ctx.supabase.rpc("set_member_role", {
      p_user_id: userId,
      p_new_role: role,
    });

    if (error) return rpcErrorToResponse(error);

    // Both roles in the row. "Vitor virou admin" is half a sentence —
    // the half somebody asks about a month later is what he was before.
    await logAuditEvent(auditAdmin(), {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
      action: "member.role_changed",
      targetType: "member",
      targetId: userId,
      targetLabel: before.label,
      metadata: { from: before.role, to: role },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const before = await targetLabel(ctx.supabase, ctx.accountId, userId);

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    await logAuditEvent(auditAdmin(), {
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      actorLabel: await auditActorLabel(ctx.supabase, ctx.userId),
      action: "member.removed",
      targetType: "member",
      targetId: userId,
      targetLabel: before.label,
      metadata: { role: before.role },
    });

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
