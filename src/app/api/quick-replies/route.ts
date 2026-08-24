import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parseQuickReplyBody } from '@/lib/quick-replies/parse'
import {
  MISSING_MIGRATION_MESSAGE,
  isMissingQuickReplyColumn,
} from '@/lib/quick-replies/errors'

// Quick replies — reusable snippets (plain text, a saved interactive
// message, or a file with a caption) shared across the account. GET lists;
// POST creates. Mirrors the automations route: RLS-scoped read via the user
// client, service-role write after an explicit role check.

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    // RLS (quick_replies_select) scopes to the caller's account.
    const { data, error } = await supabase
      .from('quick_replies')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Shortcuts first, alphabetically: the `/` panel renders this order, and
    // a snippet somebody bothered to name `/frete` is the one they are
    // reaching for. Newest-first underneath, which is what the query gave us.
    //
    // Sorted here rather than by the database because `.order('shortcut')`
    // is an error until migration 044 has been applied, and a listing that
    // 500s would take the whole feature down for the sake of an ordering.
    const rows = (data ?? []) as { shortcut?: string | null }[]
    rows.sort((a, b) => {
      const x = a.shortcut ?? ''
      const y = b.shortcut ?? ''
      if (!x && !y) return 0
      if (!x) return 1
      if (!y) return -1
      return x.localeCompare(y)
    })
    return NextResponse.json({ quick_replies: rows })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const parsed = parseQuickReplyBody(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin()
    .from('quick_replies')
    .insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      ...parsed.value,
    })
    .select()
    .single()

  if (error) {
    // 23505 is the partial unique index from migration 044. Two people
    // claiming `/frete` is a thing that will happen, and "duplicate key
    // value violates unique constraint" is not a sentence to show them.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `The shortcut /${parsed.value.shortcut} is already taken.` },
        { status: 409 },
      )
    }
    if (isMissingQuickReplyColumn(error)) {
      return NextResponse.json({ error: MISSING_MIGRATION_MESSAGE }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ quick_reply: data }, { status: 201 })
}
