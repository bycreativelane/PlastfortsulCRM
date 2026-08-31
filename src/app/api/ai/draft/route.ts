import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { forAssist, loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/draft  (agent+)
 *
 * Body: { conversation_id, message_id? }
 * Returns: { draft, sources[], tools[] }
 *
 * Uses the account's configured provider/key (BYO). Read-only: it never
 * sends or stores anything, just hands text back to the composer.
 *
 * ONE ROUTE, TWO ENTRY POINTS, and that is deliberate. The composer's
 * "draft with AI" button has always called this with a conversation; the
 * new "sugerir resposta" on a single customer message calls it with a
 * `message_id` as well. The work either way is: read the thread,
 * retrieve from the knowledge base, ask the model. Splitting that into a
 * second route would have been two copies of the rate limiting, the
 * config load, the usage logging and the error mapping, drifting from
 * each other from the first bug fix onwards.
 *
 * WHAT `message_id` CHANGES: it names which customer message the answer
 * is for. Without it the model answers the newest thing said, which is
 * right most of the time and wrong exactly when a customer sent four
 * messages and the agent wants help with the second one.
 *
 * WHAT `sources` ADDS: the knowledge excerpts the answer was grounded
 * in. A suggestion a person cannot check is a suggestion they either
 * paste blindly or ignore, and both are worse than not offering one.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-draft:${userId}`, RATE_LIMITS.aiDraft)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    // Also cap the whole team's draws on the shared BYO provider key.
    const accountLimit = checkRateLimit(
      `ai-draft-acct:${accountId}`,
      RATE_LIMITS.aiDraftAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    const messageId =
      body && typeof body.message_id === 'string' ? body.message_id : null
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }

    // RLS scopes the SSR client to the caller's account, so a missing
    // row means "not yours / not found" either way.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/draft] conversation lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // `gate: 'assist'` and not the agent's switch. Asking for a suggested
    // reply is a person asking for help writing — it has nothing to do
    // with whether a robot is allowed to answer customers by itself, and
    // before 057 turning that robot off took this button with it.
    const loaded = await loadAiConfig(supabase, accountId, {
      gate: 'assist',
    }).catch((err) => {
      // Decrypt failure — surface distinctly from "not configured".
      console.error('[ai/draft] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    // The assist model, when the account set one. Everything below reads
    // plain `config.model`, so the swap happens once and here.
    const config = loaded ? forAssist(loaded) : null

    if (!config) {
      return NextResponse.json(
        {
          error:
            'AI assist is not set up. Enable it in Settings → AI assist.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    // And the per-feature switch on top of the master one. Two levels
    // because "I want transcription but not suggested replies" is a
    // real position, and it is the position of anybody who does not
    // want a model writing in their voice.
    if (!config.assistEnabled) {
      return NextResponse.json(
        {
          error: 'Suggested replies are turned off for this account.',
          code: 'assist_disabled',
        },
        { status: 400 },
      )
    }

    const messages = await buildConversationContext(supabase, conversationId)
    // Nothing to draft from — a brand-new thread with no customer text
    // would otherwise produce a nonsensical reply-to-nothing.
    if (messages.length === 0) {
      return NextResponse.json(
        {
          error: 'No messages to draft from yet.',
          code: 'no_messages',
        },
        { status: 400 },
      )
    }

    // WHICH message the answer is for.
    //
    // `message_id` is looked up rather than trusted: it has to be in this
    // conversation, and it has to be from the customer. Drafting a reply
    // to something the business itself said is a request that can only be
    // a mistake, and answering it anyway produces a reply that reads like
    // the assistant is talking to itself.
    let focus: string | null = null
    if (messageId) {
      const { data: row } = await supabase
        .from('messages')
        .select('content_text, media_transcript, sender_type')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .maybeSingle()
      const message = row as {
        content_text?: string | null
        media_transcript?: string | null
        sender_type?: string | null
      } | null
      if (message?.sender_type === 'customer') {
        // The transcript counts. A voice note has no `content_text`, and
        // "sugerir resposta" on an audio the agent has not listened to
        // yet is one of the most useful versions of this button there is
        // — see migration 049.
        focus = (message.content_text || message.media_transcript || '').trim() || null
      }
    }

    // Ground the draft in the account's knowledge base (best-effort —
    // returns [] when there's no KB or retrieval fails). The FOCUS
    // message is the better query when there is one: retrieval against
    // "ok obrigado" finds nothing useful, retrieval against the question
    // three messages up finds the answer.
    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      focus || latestUserMessage(messages),
      config.retrievalTopK,
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge,
      persona: {
        personaName: config.personaName,
        businessDescription: config.businessDescription,
        tone: config.tone,
        guardrails: config.guardrails,
        escalationRules: config.escalationRules,
      },
      hasTools: config.enabledTools.length > 0,
    })

    // Appended to the transcript rather than folded into the system
    // prompt: it is a fact about THIS request, and the system prompt is
    // where the account's standing instructions live.
    const turns = focus
      ? [
          ...messages,
          {
            role: 'user' as const,
            content: `(O atendente pediu ajuda especificamente com esta mensagem do cliente: "${focus}". Responda a ela.)`,
          },
        ]
      : messages

    const toolsUsed: string[] = []
    const { text, usage } = await generateReply({
      config,
      systemPrompt,
      messages: turns,
      toolContext: {
        db: supabase,
        accountId,
        contactId: (conversation as { contact_id?: string | null }).contact_id ?? null,
        conversationId,
      },
      onToolUsed: (name) => {
        if (!toolsUsed.includes(name)) toolsUsed.push(name)
      },
    })

    // Record spend on the account's BYO key. Best-effort + via the
    // service role (the log has no `authenticated` INSERT policy). This
    // must not fail or delay the draft the agent is waiting on, so:
    //  - the whole thing is wrapped (constructing the admin client throws
    //    if the service-role key is unset — that must not 500 the draft);
    //  - it's fire-and-forget (`void`), not awaited, so the response
    //    isn't held for a DB round-trip.
    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage,
      })
    } catch (logErr) {
      console.error('[ai/draft] usage log skipped:', logErr)
    }

    return NextResponse.json({
      draft: text,
      // Truncated, because these are shown in a panel beside the draft
      // and a full chunk is a page. Enough to recognise which document
      // it came from and check the claim.
      sources: knowledge.map((excerpt) => excerpt.slice(0, 320)),
      tools: toolsUsed,
    })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
