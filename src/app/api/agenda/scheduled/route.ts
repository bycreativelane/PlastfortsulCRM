import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

/**
 * GET /api/agenda/scheduled?from=<iso>&to=<iso>
 *
 * What the automation engine is going to do, and when — the machine half of
 * the dashboard agenda.
 *
 * WHY A ROUTE AND NOT A QUERY. Every other source the agenda reads comes
 * straight from the browser under RLS. This one cannot: migration 006 turned
 * RLS on for `automation_pending_executions` and deliberately wrote NO policy
 * for authenticated users, because until now every reader was the engine
 * itself holding the service-role key. Rather than widen that table to the
 * client — a policy is a permanent grant, and the row carries the rendered
 * message bodies in `context` — the read happens here, scoped to the caller's
 * own account, and only five columns come back. `context` never leaves the
 * server.
 *
 * Any member may call it. Seeing that a follow-up goes out on Thursday is the
 * same information the automation's own page already shows, and a viewer who
 * cannot see it is a viewer who has to ask somebody.
 */

/** Six weeks is what the calendar draws; a request for more is a mistake. */
const MAX_WINDOW_DAYS = 120;

interface PendingRow {
  id: string;
  run_at: string;
  automation_id: string | null;
  automations: { name: string | null } | { name: string | null }[] | null;
  contacts:
    | { name: string | null; phone: string | null }
    | { name: string | null; phone: string | null }[]
    | null;
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const { searchParams } = new URL(request.url);
    const from = parseDate(searchParams.get('from'));
    const to = parseDate(searchParams.get('to'));
    if (!from || !to || to.getTime() < from.getTime()) {
      return NextResponse.json(
        { error: 'from and to must be ISO timestamps, from before to' },
        { status: 400 }
      );
    }
    if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
      return NextResponse.json(
        { error: `Window must be ${MAX_WINDOW_DAYS} days or less` },
        { status: 400 }
      );
    }

    // A self-hosted instance without the service-role key has no automation
    // engine either — nothing writes this table, so there is nothing to show.
    // An empty lane is the honest answer; a 500 would take the whole calendar
    // down for a feature that instance does not run.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ items: [] });
    }

    const { data, error } = await supabaseAdmin()
      .from('automation_pending_executions')
      .select(
        'id, run_at, automation_id, automations(name), contacts(name, phone)'
      )
      // The whole reason this is safe to serve with elevated rights.
      .eq('account_id', ctx.accountId)
      .eq('status', 'pending')
      .gte('run_at', from.toISOString())
      .lte('run_at', to.toISOString())
      .order('run_at', { ascending: true })
      .limit(200);

    if (error) {
      console.error('[GET /api/agenda/scheduled] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load scheduled actions' },
        { status: 500 }
      );
    }

    const items = ((data ?? []) as unknown as PendingRow[]).map((row) => {
      const automation = one(row.automations);
      const contact = one(row.contacts);
      return {
        id: row.id,
        run_at: row.run_at,
        automation_id: row.automation_id,
        automation_name: automation?.name ?? null,
        contact_name: contact?.name || contact?.phone || null,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Unwrap a to-one embed. PostgREST returns an object; supabase-js cannot know
 * the cardinality without generated types and infers an array. Same helper,
 * same reason, as `lib/dashboard/today.ts`.
 */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
