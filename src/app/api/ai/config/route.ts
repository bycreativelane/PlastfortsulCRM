import { NextResponse } from 'next/server'
import { isUnknownColumn } from '@/lib/supabase/pg-errors'
import { AI_TOOL_NAMES } from '@/lib/ai/tools'
import { auditAdmin } from '@/lib/audit/admin-client'
import { auditActorLabel, logAuditEvent } from '@/lib/audit/log'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { AiError, type AiProvider } from '@/lib/ai/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    // `api_key` is selected only to derive `has_key` — it is stripped out
    // below and never returned to the client.
    const BASE_COLUMNS =
      'provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key'

    // Post-053 fields. Same ladder as the loader in `@/lib/ai/config`,
    // one rung longer: widest first, then 049's column, then the
    // original set. Naming a column the database has not got is a 42703
    // for the whole row, and this row is the whole IA settings page.
    const COLUMNS_053 =
      'persona_name, business_description, tone, guardrails, escalation_rules, enabled_tools, retrieval_top_k, assist_enabled, setup_completed_at'

    // And 057's own rung. It has to be SEPARATE from 053's, not appended
    // to it: merged into one string, a database that has 053 but not 057
    // fails the widest SELECT and falls all the way back to 049 — losing
    // the persona, the tools and the retrieval depth it does have, and
    // showing the admin an empty form for settings that are saved.
    const COLUMNS_057 =
      'assist_is_active, assist_model, transcribe_audio_enabled, describe_image_enabled, read_document_enabled'

    let { data, error } = await supabase
      .from('ai_configs')
      .select(
        `${BASE_COLUMNS}, media_understanding_enabled, ${COLUMNS_053}, ${COLUMNS_057}`
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error && isUnknownColumn(error)) {
      ;({ data, error } = await supabase
        .from('ai_configs')
        .select(`${BASE_COLUMNS}, media_understanding_enabled, ${COLUMNS_053}`)
        .eq('account_id', accountId)
        .maybeSingle())
    }

    if (error && isUnknownColumn(error)) {
      ;({ data, error } = await supabase
        .from('ai_configs')
        .select(`${BASE_COLUMNS}, media_understanding_enabled`)
        .eq('account_id', accountId)
        .maybeSingle())
    }

    // Migrations here are applied by hand, so this route can know about a
    // column the database does not. Naming it in the SELECT is a 42703 for
    // the WHOLE row, which would take the entire IA settings page down over
    // one toggle that has not shipped yet — so retry without it and let the
    // form fall back to its default.
    if (error && isUnknownColumn(error)) {
      ;({ data, error } = await supabase
        .from('ai_configs')
        .select(BASE_COLUMNS)
        .eq('account_id', accountId)
        .maybeSingle())
    }

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }

    if (!data) return NextResponse.json({ configured: false })
    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') {
      return bad('provider must be "openai" or "anthropic"')
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true

    // Transcribe inbound audio, describe inbound images (migration 049).
    // ABSENT MEANS UNCHANGED, not false — the same rule the handoff target
    // follows, and for the same reason: this route is what the form posts
    // when an admin flips any single toggle on the page, and a field the
    // form did not send must not be reset by that save. A form built
    // before 049 shipped would otherwise turn the feature off on every
    // unrelated edit.
    const mediaUnderstandingProvided = 'media_understanding_enabled' in body
    const mediaUnderstandingEnabled = body.media_understanding_enabled === true

    /**
     * The structured prompt, the tools and the dials (migration 053).
     *
     * ABSENT MEANS UNCHANGED for every one of them — the same rule the
     * handoff target and the media switch follow. The wizard saves one
     * step at a time, so a request that carries only `business_description`
     * must not wipe the guardrails somebody wrote on the next screen.
     */
    const text = (key: string): string | null | undefined => {
      if (!(key in body)) return undefined
      const raw = body[key]
      if (raw === null) return null
      return typeof raw === 'string' && raw.trim() ? raw.trim() : null
    }

    const personaName = text('persona_name')
    const businessDescription = text('business_description')
    const guardrails = text('guardrails')
    const escalationRules = text('escalation_rules')

    let tone: string | null | undefined
    if ('tone' in body) {
      tone =
        body.tone === 'formal' || body.tone === 'neutral' || body.tone === 'casual'
          ? body.tone
          : null
    }

    let enabledTools: string[] | undefined
    if ('enabled_tools' in body) {
      if (!Array.isArray(body.enabled_tools)) {
        return bad('enabled_tools must be an array of tool names')
      }
      // Rejected rather than filtered. An unknown name on the way IN is a
      // client that is out of date or a typo, and accepting the request
      // while discarding half of it is how somebody comes back tomorrow
      // asking why the switch did not stick. (`resolveTools` is tolerant
      // on the way OUT, where a stale name means a tool that used to
      // exist.)
      for (const name of body.enabled_tools) {
        if (typeof name !== 'string' || !AI_TOOL_NAMES.includes(name)) {
          return bad(`Unknown tool: ${String(name)}`)
        }
      }
      enabledTools = [...new Set(body.enabled_tools as string[])]
    }

    let retrievalTopK: number | undefined
    if ('retrieval_top_k' in body) {
      const raw = Number(body.retrieval_top_k)
      retrievalTopK = Number.isFinite(raw)
        ? Math.min(20, Math.max(0, Math.floor(raw)))
        : 4
    }

    const assistProvided = 'assist_enabled' in body
    const assistEnabled = body.assist_enabled === true

    // ---- 057: the manual tools save on their own ------------------
    //
    // Each is `in body` guarded rather than defaulted, because this one
    // route serves two screens now. The agent wizard sends the agent's
    // fields and the tools panel sends the tools' fields; whichever is
    // absent must be left ALONE, not reset to false. Defaulting here
    // would mean saving the system prompt silently switching off
    // transcription.
    const assistActiveProvided = 'assist_is_active' in body
    const assistIsActive = body.assist_is_active === true
    const assistModelProvided = 'assist_model' in body
    const assistModel =
      typeof body.assist_model === 'string' && body.assist_model.trim()
        ? body.assist_model.trim()
        : null
    const audioProvided = 'transcribe_audio_enabled' in body
    const imageProvided = 'describe_image_enabled' in body
    const documentProvided = 'read_document_enabled' in body

    const setupCompleted = body.setup_completed === true

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    let apiKeyPlain: string
    if (rawKey) {
      apiKeyPlain = rawKey
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad('Stored API key could not be decrypted — re-enter your key.')
      }
    } else {
      return bad('api_key is required')
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          embeddingsApiKey: null,
          mediaUnderstandingEnabled: false,
          personaName: null,
          businessDescription: null,
          tone: null,
          guardrails: null,
          escalationRules: null,
          enabledTools: [],
          retrievalTopK: 4,
          assistEnabled: false,
          assistIsActive: false,
          assistModel: null,
          transcribeAudioEnabled: false,
          describeImageEnabled: false,
          readDocumentEnabled: false,
          setupCompletedAt: null,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping'])
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Embeddings key: ${err.message}`, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null
    const shared: Record<string, unknown> = {
      provider,
      model,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    if (mediaUnderstandingProvided) {
      shared.media_understanding_enabled = mediaUnderstandingEnabled
    }
    if (personaName !== undefined) shared.persona_name = personaName
    if (businessDescription !== undefined) {
      shared.business_description = businessDescription
    }
    if (tone !== undefined) shared.tone = tone
    if (guardrails !== undefined) shared.guardrails = guardrails
    if (escalationRules !== undefined) shared.escalation_rules = escalationRules
    if (enabledTools !== undefined) shared.enabled_tools = enabledTools
    if (retrievalTopK !== undefined) shared.retrieval_top_k = retrievalTopK
    if (assistProvided) shared.assist_enabled = assistEnabled
    if (assistActiveProvided) shared.assist_is_active = assistIsActive
    if (assistModelProvided) shared.assist_model = assistModel
    if (audioProvided) {
      shared.transcribe_audio_enabled = body.transcribe_audio_enabled === true
    }
    if (imageProvided) {
      shared.describe_image_enabled = body.describe_image_enabled === true
    }
    if (documentProvided) {
      shared.read_document_enabled = body.read_document_enabled === true
    }
    // Stamped once, by the last step of the wizard. Never cleared here —
    // "this was configured on purpose" does not stop being true because
    // somebody later edited one field.
    if (setupCompleted) shared.setup_completed_at = new Date().toISOString()
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null
    }

    /**
     * Drop the post-049 field and try again.
     *
     * The form always sends `media_understanding_enabled`, and until the
     * migration is applied that one key turns every save on this page into
     * a 500 — the admin edits the system prompt and is told the whole
     * configuration failed. The toggle is the only thing that cannot be
     * saved yet, so it is the only thing that should fail.
     */
    const withoutNewColumns = (row: Record<string, unknown>) => {
      const next = { ...row }
      for (const key of [
        'media_understanding_enabled',
        'persona_name',
        'business_description',
        'tone',
        'guardrails',
        'escalation_rules',
        'enabled_tools',
        'retrieval_top_k',
        'assist_enabled',
        'setup_completed_at',
        'assist_is_active',
        'assist_model',
        'transcribe_audio_enabled',
        'describe_image_enabled',
        'read_document_enabled',
      ]) {
        delete next[key]
      }
      return next
    }

    if (existing) {
      const payload = encryptedKey ? { ...shared, api_key: encryptedKey } : shared
      let { error: upErr } = await supabase
        .from('ai_configs')
        .update(payload)
        .eq('account_id', accountId)
      if (upErr && isUnknownColumn(upErr)) {
        ;({ error: upErr } = await supabase
          .from('ai_configs')
          .update(withoutNewColumns(payload))
          .eq('account_id', accountId))
      }
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    } else {
      const payload = {
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      }
      let { error: insErr } = await supabase.from('ai_configs').insert(payload)
      if (insErr && isUnknownColumn(insErr)) {
        ;({ error: insErr } = await supabase
          .from('ai_configs')
          .insert(withoutNewColumns(payload)))
      }
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    }

    // WHICH SWITCHES, never the key. The question this row answers is
    // "quem ligou a resposta automática" — and the fields below are
    // exactly the ones whose flip changes what customers receive.
    await logAuditEvent(auditAdmin(), {
      accountId,
      actorUserId: userId,
      actorLabel: await auditActorLabel(supabase, userId),
      action: 'ai.config_updated',
      targetType: 'setting',
      targetId: 'ai',
      metadata: {
        provider,
        model,
        is_active: isActive,
        auto_reply_enabled: autoReplyEnabled,
        media_understanding_enabled: mediaUnderstandingProvided
          ? mediaUnderstandingEnabled
          : undefined,
        key_replaced: Boolean(rawKey),
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete AI configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
