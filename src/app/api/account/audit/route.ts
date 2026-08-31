// ============================================================
// GET /api/account/audit
//
// The account's own history: who did what, when. Admin and up — the
// same bar `account_audit_log`'s RLS policy sets (migration 050), and
// for the same reason. The log carries every member's sign-in times,
// which is a different class of fact from the operational data an agent
// reads all day.
//
// Query
//   ?limit=  1–200, default 50
//   ?before= ISO timestamp — the `created_at` of the oldest row you
//            already hold. Keyset paging rather than OFFSET: the table
//            only ever grows at the head, so an offset would re-shuffle
//            under a reader while somebody signs in.
//   ?actor=  auth uid, to narrow to one person
//   ?area=   session | member | account | key | integration
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { auditArea, type AuditEntry } from '@/lib/audit/events';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Which action prefixes belong to each area.
 *
 * The filter runs in SQL, so it cannot call `auditArea` — that function
 * derives the area from a row it already has. These are the same
 * groupings expressed as the `LIKE` patterns PostgREST can push down.
 */
const AREA_PREFIXES: Record<string, string[]> = {
  session: ['session.'],
  member: ['member.'],
  account: ['account.'],
  key: ['api_key.'],
  integration: ['ai.', 'whatsapp.'],
};

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(request.url);

    const rawLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(rawLimit)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
      : DEFAULT_LIMIT;

    let query = ctx.supabase
      .from('account_audit_log')
      .select(
        'id, action, actor_user_id, actor_label, target_type, target_id, target_label, metadata, created_at'
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      // One more than asked for, so the client can tell "this is the end"
      // from "there is another page" without a count query.
      .limit(limit + 1);

    const before = url.searchParams.get('before');
    if (before) query = query.lt('created_at', before);

    const actor = url.searchParams.get('actor');
    if (actor) query = query.eq('actor_user_id', actor);

    const area = url.searchParams.get('area');
    const prefixes = area ? AREA_PREFIXES[area] : undefined;
    if (prefixes) {
      query = query.or(prefixes.map((p) => `action.like.${p}*`).join(','));
    }

    const { data, error } = await query;

    if (error) {
      // Pre-050 the table does not exist, and that is the ONLY thing
      // this route can be wrong about on a healthy deployment. Answering
      // "the log is empty and not yet available" lets the panel draw the
      // waiting-on-a-migration state instead of a red error over a
      // feature that has simply not landed — the same courtesy the team
      // room extends for 046.
      const missing =
        error.code === 'PGRST205' ||
        error.code === '42P01' ||
        /account_audit_log/i.test(error.message ?? '');
      if (missing) {
        return NextResponse.json({ entries: [], hasMore: false, pending: true });
      }
      console.error('[GET /api/account/audit] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load the audit log' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as AuditEntry[];
    const hasMore = rows.length > limit;

    return NextResponse.json({
      entries: rows.slice(0, limit).map((row) => ({
        ...row,
        area: auditArea(row.action),
      })),
      hasMore,
      pending: false,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
