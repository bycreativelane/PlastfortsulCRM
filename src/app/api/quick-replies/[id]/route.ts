import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import {
  normalizeShortcut,
  parseQuickReplyContent,
} from '@/lib/quick-replies/parse'
import {
  MISSING_MIGRATION_MESSAGE,
  isMissingQuickReplyColumn,
} from '@/lib/quick-replies/errors'

// Update / delete a single quick reply. Quick replies are account-
// shared, so every mutation is scoped by `account_id` (the service-role
// client bypasses the agent-gated RLS, so both the role check and the
// account scope are enforced here).

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
    update.title = title
  }

  // Sent as `''` when the editor's shortcut field is cleared, which has to
  // mean "no shortcut" and not "leave it alone" — otherwise a shortcut can
  // be typed but never taken back.
  if ('shortcut' in body) update.shortcut = normalizeShortcut(body.shortcut)

  // When `kind` is supplied (e.g. the editor flips Text ↔ Interactive ↔
  // Media), it drives which content column is authoritative and the others
  // are cleared — otherwise a switched row keeps a stale payload the picker
  // mis-routes on.
  if ('kind' in body) {
    const content = parseQuickReplyContent(body)
    if (!content.ok) return NextResponse.json({ error: content.error }, { status: 400 })
    Object.assign(update, content.value)
  } else {
    // No kind change — allow partial edits of whichever field the row uses.
    if ('content_text' in body) update.content_text = body.content_text ?? null
    if ('media_url' in body) update.media_url = body.media_url ?? null
    if ('media_type' in body) update.media_type = body.media_type ?? null
    if ('interactive_payload' in body) {
      if (body.interactive_payload != null) {
        const result = validateInteractivePayload(body.interactive_payload)
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
      }
      update.interactive_payload = body.interactive_payload ?? null
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabaseAdmin()
    .from('quick_replies')
    .update(update)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) {
    // The partial unique index from migration 044 — see the POST route.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `The shortcut /${update.shortcut} is already taken.` },
        { status: 409 },
      )
    }
    if (isMissingQuickReplyColumn(error)) {
      return NextResponse.json({ error: MISSING_MIGRATION_MESSAGE }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { error } = await supabaseAdmin()
    .from('quick_replies')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
