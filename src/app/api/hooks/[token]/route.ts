import { NextResponse } from 'next/server';
import { after } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  clientIpFrom,
  dedupeKeyFor,
  flattenToVars,
  hashHookToken,
  ipAllowed,
  phoneFrom,
} from '@/lib/hooks/inbound';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

/**
 * POST /api/hooks/<token> — the door Typebot, n8n and landing pages knock on.
 *
 * ------------------------------------------------------------------
 * THIS IS THE ONLY UNAUTHENTICATED WRITE PATH IN THE PRODUCT
 * ------------------------------------------------------------------
 *
 * Everything else either carries a session or an API key. This one
 * carries a token in the URL, because the tools on the other end are
 * no-code and a header is the difference between "paste the URL" and
 * "give up on the integration".
 *
 * The safety does not come from keeping that URL secret — it will leak,
 * in a screenshot or a proxy log, and designing against that is losing.
 * It comes from four layers, in this order:
 *
 *   1. THE TOKEN     matched against a stored SHA-256, never the text
 *   2. THE IP LIST   free to enforce when both ends are self-hosted
 *   3. THE RATE CAP  the only one that sees a runaway n8n loop
 *   4. THE SCOPE     enforced in the ENGINE, not here — a hook without
 *                    `messages` cannot make the number send anything
 *
 * Layer 4 is the one that matters most, and it is deliberately not in
 * this file. See `runStep` in the automations engine.
 *
 * ------------------------------------------------------------------
 * IT ALWAYS ANSWERS 200 ON A KNOWN HOOK
 * ------------------------------------------------------------------
 *
 * Once the token is good, the response says "received" whatever happens
 * downstream. Typebot and n8n retry on non-2xx, so returning 500 for an
 * automation that failed would replay the payload every few minutes —
 * and every replay would run the steps that DID work a second time.
 * What went wrong is recorded on the delivery row instead, which is what
 * the screen reads.
 *
 * Unknown or disabled token is 404 with no detail: a probe should not be
 * able to tell a real-but-revoked hook from one that never existed.
 */

const MAX_BODY_BYTES = 64 * 1024;

/** 60/min per hook — the same ceiling `RATE_LIMITS.send` uses. A form
 *  fills a few times a minute; a loop does not. */
const HOOK_RATE = { limit: 60, windowMs: 60_000 } as const;

interface HookRow {
  id: string;
  account_id: string;
  name: string;
  scopes: string[];
  allowed_ips: string[];
  enabled: boolean;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Shape check before touching the database. A token is a fixed
  // alphabet and a known prefix, so anything else is a scan and deserves
  // no query.
  if (!token || !/^whk_[A-Za-z0-9_-]{20,120}$/.test(token)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from('webhook_hooks')
    .select('id, account_id, name, scopes, allowed_ips, enabled')
    .eq('token_hash', hashHookToken(token))
    .maybeSingle();

  // Same answer for "no such hook" and "hook turned off". Distinguishing
  // them tells a prober which tokens are real.
  if (error || !data || !(data as HookRow).enabled) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const hook = data as HookRow;

  // ---- Layer 2: where it may speak from ----------------------------
  const ip = clientIpFrom(request.headers);
  if (!ipAllowed(hook.allowed_ips, ip)) {
    await recordDelivery(hook, null, 'rejected', null, `ip ${ip ?? 'unknown'} not allowed`);
    // 403 and not 404: the token WAS right, and the operator debugging
    // their own integration needs to be able to tell "wrong address"
    // from "wrong token". A prober who got this far already knows the
    // token is real.
    return NextResponse.json({ error: 'ip_not_allowed' }, { status: 403 });
  }

  // ---- Layer 3: the ceiling ----------------------------------------
  const limit = checkRateLimit(`hook:${hook.id}`, HOOK_RATE);
  if (!limit.success) return rateLimitResponse(limit);

  // ---- The body ----------------------------------------------------
  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_BODY_BYTES) {
    await recordDelivery(hook, null, 'rejected', null, 'payload too large');
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    await recordDelivery(hook, null, 'rejected', null, 'body is not a JSON object');
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // ---- Idempotency -------------------------------------------------
  //
  // Written BEFORE the work, not after. The unique index is what makes a
  // retry that arrives while the first one is still running lose the
  // race — recording afterwards would let both pass and create the deal
  // twice, which is the exact failure this is for.
  const dedupeKey = dedupeKeyFor(payload);
  const contactId = await resolveContact(hook, payload);
  const delivery = await recordDelivery(
    hook,
    payload,
    'accepted',
    contactId,
    null,
    dedupeKey
  );

  if (delivery.outcome === 'duplicate') {
    return NextResponse.json({ status: 'duplicate' }, { status: 200 });
  }

  await db
    .from('webhook_hooks')
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq('id', hook.id);

  // ---- Hand it to the engine ---------------------------------------
  //
  // Inside `after()` so the sender gets its 200 immediately: Typebot
  // holds the visitor on a loading step while it waits, and an
  // automation that sends a template can take seconds.
  after(async () => {
    await runAutomationsForTrigger({
      accountId: hook.account_id,
      triggerType: 'webhook_received',
      contactId,
      context: {
        vars: flattenToVars(payload),
        // Layer 4. The engine reads these before every step that could
        // reach a customer.
        hook_scopes: hook.scopes,
        hook_name: hook.name,
        // Every automation this fires stamps its log with this id, so
        // the deliveries screen can show what the payload actually
        // caused. See 059.
        delivery_id: delivery.id ?? undefined,
      },
    }).catch((err) => console.error('[hook] dispatch failed:', err));
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

/**
 * The contact this payload is about, when it names one.
 *
 * FINDS, NEVER CREATES — and that is a security decision, not a
 * simplification. A public endpoint that creates a row per call is a
 * public endpoint that fills the contact base with junk, and the
 * cheapest possible abuse of a leaked URL.
 *
 * Creating a contact is something an automation does, through a step an
 * admin wired on purpose, with the account's own rules applied. If the
 * phone is unknown the run still happens with no contact — plenty of
 * useful automations (notify the team, open a deal on an existing
 * customer) do not need one.
 */
async function resolveContact(
  hook: HookRow,
  payload: Record<string, unknown>
): Promise<string | null> {
  const phone = phoneFrom(payload);
  if (!phone) return null;

  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const { data } = await supabaseAdmin()
    .from('contacts')
    .select('id')
    .eq('account_id', hook.account_id)
    .eq('phone_normalized', normalized)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Write what arrived, so "não funcionou" is answerable.
 *
 * Returns `'duplicate'` when the unique index refused the row — that is
 * the idempotency check, done by the database rather than by a read
 * followed by a write, which two simultaneous retries would both pass.
 *
 * Never throws. A delivery log that can break the delivery is worse than
 * no delivery log.
 */
async function recordDelivery(
  hook: HookRow,
  payload: Record<string, unknown> | null,
  status: 'accepted' | 'duplicate' | 'rejected',
  contactId: string | null,
  error: string | null,
  dedupeKey?: string
): Promise<{ outcome: 'ok' | 'duplicate'; id: string | null }> {
  try {
    const { data, error: insertError } = await supabaseAdmin()
      .from('webhook_deliveries')
      .insert({
        hook_id: hook.id,
        account_id: hook.account_id,
        status,
        payload,
        contact_id: contactId,
        error,
        dedupe_key: dedupeKey ?? null,
      })
      .select('id')
      .maybeSingle();

    // 23505 — the partial unique index on (hook_id, dedupe_key).
    if (insertError?.code === '23505') return { outcome: 'duplicate', id: null };
    if (insertError) console.error('[hook] delivery log failed:', insertError);
    return { outcome: 'ok', id: (data as { id: string } | null)?.id ?? null };
  } catch (err) {
    console.error('[hook] delivery log threw:', err);
  }
  return { outcome: 'ok', id: null };
}

/**
 * GET is a health check, and answers nothing else.
 *
 * Typebot and n8n both offer to "test" a URL with a GET, and a 405 there
 * reads as a broken endpoint. It reports only that the token resolves —
 * no account, no name, no scopes. Somebody holding the token learns
 * whether it is live; somebody guessing learns nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || !/^whk_[A-Za-z0-9_-]{20,120}$/.test(token)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const { data } = await supabaseAdmin()
    .from('webhook_hooks')
    .select('id')
    .eq('token_hash', hashHookToken(token))
    .eq('enabled', true)
    .maybeSingle();

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ status: 'ready' }, { status: 200 });
}
