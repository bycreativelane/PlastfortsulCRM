// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { parseOverrides } from "@/lib/auth/capabilities";
import { isUnknownColumn } from "@/lib/supabase/pg-errors";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  /** Migration 050. Absent on the pre-050 fallback select. */
  last_sign_in_at?: string | null;
  permission_overrides?: unknown;
  /** Migration 051. Absent on the fallback select. */
  auto_assign_opt_out?: boolean | null;
}

/** The columns that predate 050, so the select can retry without it. */
const BASE_COLUMNS =
  "user_id, full_name, email, avatar_url, account_role, created_at";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // RLS on profiles allows reading any row whose account matches
    // the caller's, so this query is naturally account-scoped.
    // Typed as the widest shape of the two selects below — PostgREST
    // infers a narrower row for the fallback, and the two branches have
    // to land in one variable.
    const wide = await ctx.supabase
      .from("profiles")
      .select(
        `${BASE_COLUMNS}, last_sign_in_at, permission_overrides, auto_assign_opt_out`
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });
    let data = wide.data as ProfileRow[] | null;
    let error = wide.error;

    // Migrations here are applied by hand. Naming a post-050 column on a
    // pre-050 database is a 42703 for the whole query, and this one feeds
    // the Team tab — losing the roster to gain a "last access" column
    // would be a poor trade. Retry without them.
    if (error && isUnknownColumn(error)) {
      const fallback = await ctx.supabase
        .from("profiles")
        .select(BASE_COLUMNS)
        .eq("account_id", ctx.accountId)
        .order("created_at", { ascending: true });
      data = fallback.data as ProfileRow[] | null;
      error = fallback.error;
    }

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);

    // "Último acesso" is two facts and the roster shows the later one.
    //
    // `last_sign_in_at` (050) is when they authenticated;
    // `member_presence.last_seen_at` (024) is when they were last
    // actually doing something. Somebody who signed in on Monday and has
    // had the tab open since is "active 2 minutes ago", not "last seen
    // Monday" — and somebody who signed in this morning and closed it is
    // the opposite case. Either one alone reads as wrong on half the
    // team.
    //
    // Admins only: a shared inbox where every agent can see every other
    // agent's session times is a different workplace, and the roster is
    // visible to everyone.
    const lastActive = new Map<string, string>();
    if (canSeeEmails) {
      const { data: presence } = await ctx.supabase
        .from("member_presence")
        .select("user_id, last_seen_at")
        .eq("account_id", ctx.accountId);
      for (const row of (presence ?? []) as Array<{
        user_id: string;
        last_seen_at: string;
      }>) {
        lastActive.set(row.user_id, row.last_seen_at);
      }
    }

    const later = (a: string | null, b: string | null): string | null => {
      if (!a) return b;
      if (!b) return a;
      return a > b ? a : b;
    };

    const members: AccountMember[] = (data ?? []).flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
          last_access_at: canSeeEmails
            ? later(row.last_sign_in_at ?? null, lastActive.get(row.user_id) ?? null)
            : null,
          permission_overrides: canSeeEmails
            ? parseOverrides(row.permission_overrides)
            : {},
          // Not gated on `canSeeEmails`: who is in the support rotation
          // is operational, not personal. An agent looking at the roster
          // has a real reason to know a colleague is out of it — it is
          // why the thread came to them.
          auto_assign_opt_out: row.auto_assign_opt_out === true,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
