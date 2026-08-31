import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { forAssist, loadAiConfig } from '@/lib/ai/config';
import { understandInboundMedia } from '@/lib/ai/media-understanding';

/**
 * POST /api/ai/understand — read THIS attachment, now.  (agent+)
 *
 * ------------------------------------------------------------------
 * THE GAP THIS CLOSES
 * ------------------------------------------------------------------
 *
 * Media understanding has only ever run at the moment a message
 * arrives. Everything that landed before the account turned it on — or
 * while the provider was down, or before migration 049 existed — has no
 * transcript and, until now, no way to get one. An attendant opening a
 * six-month-old thread full of voice notes could see that the feature
 * exists and that it had not been applied to anything in front of them.
 *
 * This is the same code path, pointed at one message on request.
 *
 * ------------------------------------------------------------------
 * IT CAN ONLY READ WHAT IS STILL THERE
 * ------------------------------------------------------------------
 *
 * `media_url` holds one of two things: a permanent URL in the account's
 * own bucket (mirrored on arrival), or `/api/whatsapp/media/<id>` — a
 * pointer at Meta, whose media EXPIRES. The first always works; the
 * second works until it does not, and the honest answer then is to say
 * the file is gone rather than to retry into a 404.
 */

interface Body {
  message_id?: unknown;
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');

    // The same bucket as the draft: this is a provider call somebody
    // pressed a button for, and a held key on a shared account.
    const limit = checkRateLimit(`ai-understand:${userId}`, RATE_LIMITS.aiDraft);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as Body;
    const messageId =
      typeof body.message_id === 'string' ? body.message_id.trim() : '';
    if (!messageId) {
      return NextResponse.json({ error: 'message_id_required' }, { status: 400 });
    }

    const db = supabaseAdmin();

    // TENANCY THROUGH THE CONVERSATION. `messages` has no `account_id`
    // of its own, and this client bypasses RLS — so the join is not a
    // convenience, it is the check.
    const { data: row } = await db
      .from('messages')
      .select(
        'id, conversation_id, media_url, content_type, conversation:conversations!inner(account_id)'
      )
      .eq('id', messageId)
      .maybeSingle();

    // PostgREST returns an embedded row as an object or an array
    // depending on the relationship it infers; neither shape is assumed.
    const embedded = (row as { conversation?: unknown } | null)?.conversation;
    const conversation = (
      Array.isArray(embedded) ? embedded[0] : embedded
    ) as { account_id: string } | undefined;

    if (!row || !conversation || conversation.account_id !== accountId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const message = row as unknown as {
      id: string;
      conversation_id: string;
      media_url: string | null;
    };

    if (!message.media_url) {
      return NextResponse.json({ error: 'no_attachment' }, { status: 400 });
    }

    const config = await loadAiConfig(db, accountId, { gate: 'assist' });
    if (!config) {
      return NextResponse.json({ error: 'assist_disabled' }, { status: 400 });
    }

    // ---- The bytes ---------------------------------------------------
    //
    // A bucket URL is absolute and public; the proxy path is relative
    // and needs this app's own origin. Both are fetched the same way
    // from here — the difference is only how the URL is built.
    const origin = new URL(request.url).origin;
    const href = message.media_url.startsWith('http')
      ? message.media_url
      : `${origin}${message.media_url}`;

    let bytes: Buffer;
    let mimeType = '';
    try {
      const res = await fetch(href, {
        headers: { cookie: request.headers.get('cookie') ?? '' },
      });
      if (!res.ok) throw new Error(String(res.status));
      mimeType = res.headers.get('content-type') ?? '';
      bytes = Buffer.from(await res.arrayBuffer());
    } catch {
      // Meta's copy expired, or the object was removed. Saying so beats
      // a generic failure the attendant would retry three times.
      return NextResponse.json({ error: 'media_gone' }, { status: 410 });
    }

    const result = await understandInboundMedia({
      db,
      accountId,
      conversationId: message.conversation_id,
      messageId: message.id,
      config: forAssist(config),
      bytes,
      mimeType,
    });

    if (result.status !== 'done' || !result.text) {
      return NextResponse.json(
        { error: result.status === 'unsupported' ? 'unsupported' : 'failed' },
        { status: 422 }
      );
    }

    return NextResponse.json({ text: result.text, mode: result.mode });
  } catch (err) {
    return toErrorResponse(err);
  }
}
