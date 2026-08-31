import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * What this hook received, and what each payload actually caused.
 *
 * ------------------------------------------------------------------
 * THIS IS THE SCREEN THAT DECIDES WHETHER ANYBODY USES THE FEATURE
 * ------------------------------------------------------------------
 *
 * n8n's real advantage over an inbound webhook is not capability, it is
 * that you can SEE an execution — payload, step, error. Without the
 * same thing here, the first time an integration goes quiet somebody
 * puts n8n back in the path just to get visibility, and that is a tool
 * chosen for the wrong reason.
 *
 * So a delivery does not just say "accepted". It carries the automation
 * runs it caused (`automation_logs.delivery_id`, migration 059) with
 * their status and the steps each one executed — which is where "it
 * arrived but nothing happened" gets its answer.
 *
 * Admin only: the payload holds a phone and a name.
 */

const PAGE_SIZE = 25;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;

    // `account_id` in the filter as well as in the RLS policy: the
    // policy is the control, this is what makes a mistake in it fail
    // closed instead of returning another account's payloads.
    const { data: deliveries, error } = await supabase
      .from('webhook_deliveries')
      .select('id, received_at, status, payload, contact_id, error, dedupe_key')
      .eq('hook_id', id)
      .eq('account_id', accountId)
      .order('received_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      return NextResponse.json({ deliveries: [], pending: true });
    }

    const rows = (deliveries ?? []) as { id: string }[];
    if (rows.length === 0) return NextResponse.json({ deliveries: [] });

    /**
     * The runs, in ONE query for the whole page.
     *
     * Per-delivery would be 25 round trips to draw a list — the classic
     * N+1, and on a screen somebody opens precisely when things are
     * already going wrong.
     *
     * `delivery_id` arrives with 059; on a database without it the
     * select fails and the deliveries still render, with no runs
     * attached. Degrading to "less detail" rather than to "the screen is
     * broken" is the same ladder every reader in this codebase uses.
     */
    let runsByDelivery: Record<string, unknown[]> = {};
    const { data: runs } = await supabase
      .from('automation_logs')
      .select(
        'id, delivery_id, automation_id, status, error_message, steps_executed, created_at, automation:automations(name)'
      )
      .in(
        'delivery_id',
        rows.map((d) => d.id)
      )
      .eq('account_id', accountId);

    if (runs) {
      runsByDelivery = (runs as { delivery_id: string }[]).reduce(
        (acc, run) => {
          (acc[run.delivery_id] ??= []).push(run);
          return acc;
        },
        {} as Record<string, unknown[]>
      );
    }

    return NextResponse.json({
      deliveries: rows.map((d) => ({
        ...d,
        runs: runsByDelivery[d.id] ?? [],
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
