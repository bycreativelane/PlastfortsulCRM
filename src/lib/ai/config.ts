import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isUnknownColumn } from '@/lib/supabase/pg-errors'
import type { AiGate } from './types'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic'
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  media_understanding_enabled: boolean | null
  // Migration 053. Absent on either fallback SELECT below.
  persona_name?: string | null
  business_description?: string | null
  tone?: string | null
  guardrails?: string | null
  escalation_rules?: string | null
  enabled_tools?: string[] | null
  retrieval_top_k?: number | null
  assist_enabled?: boolean | null
  assist_is_active?: boolean | null
  assist_model?: string | null
  transcribe_audio_enabled?: boolean | null
  describe_image_enabled?: boolean | null
  read_document_enabled?: boolean | null
  setup_completed_at?: string | null
}

/**
 * Everything after 049, and everything before it.
 *
 * Migrations here are applied by hand, so there is a real window in which
 * this file knows about `media_understanding_enabled` and the database does
 * not. In that window a single SELECT naming the column fails with 42703 —
 * and this function is on the auto-reply path, so the failure would not be
 * "media understanding is off", it would be **the assistant stops replying
 * to anything**. The fallback below is what keeps a not-yet-applied
 * migration from taking a working feature down with it.
 */
const CONFIG_COLUMNS_BASE =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key'

const CONFIG_COLUMNS_049 = `${CONFIG_COLUMNS_BASE}, media_understanding_enabled`

/**
 * And everything after 053.
 *
 * THREE SELECTS, tried widest first, and the ladder is not tidiness — it
 * is the same argument as above, one migration further along. This
 * function is on the auto-reply path AND on the draft path, so a column
 * the database has not got yet must degrade to "that feature is off",
 * never to "the assistant is gone".
 */
const CONFIG_COLUMNS_053 = `${CONFIG_COLUMNS_049}, persona_name, business_description, tone, guardrails, escalation_rules, enabled_tools, retrieval_top_k, assist_enabled, setup_completed_at`

/**
 * And the 057 split — the manual tools stop riding on the agent's switch.
 *
 * A FOURTH rung on the ladder, for the reason the other three exist: this
 * function is on the auto-reply path, and a column the database has not
 * got yet must degrade to "that feature is off", never to "the assistant
 * is gone". See the gate below for what the pre-057 fallback means.
 */
const CONFIG_COLUMNS = `${CONFIG_COLUMNS_053}, assist_is_active, assist_model, transcribe_audio_enabled, describe_image_enabled, read_document_enabled`

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean; gate?: AiGate } = {},
): Promise<AiConfig | null> {
  // `requireActive: false` is the old spelling of `gate: 'none'`, kept so
  // the Playground call reads the same. An explicit `gate` always wins.
  const gate: AiGate =
    opts.gate ?? (opts.requireActive === false ? 'none' : 'agent')
  let { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error && isUnknownColumn(error)) {
    ;({ data, error } = await db
      .from('ai_configs')
      .select(CONFIG_COLUMNS_053)
      .eq('account_id', accountId)
      .maybeSingle())
  }

  if (error && isUnknownColumn(error)) {
    ;({ data, error } = await db
      .from('ai_configs')
      .select(CONFIG_COLUMNS_049)
      .eq('account_id', accountId)
      .maybeSingle())
  }

  if (error && isUnknownColumn(error)) {
    ;({ data, error } = await db
      .from('ai_configs')
      .select(CONFIG_COLUMNS_BASE)
      .eq('account_id', accountId)
      .maybeSingle())
  }

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow

  /**
   * WHICH SWITCH DECIDES, and this is the sharpest edge in the file.
   *
   *   'agent'  → `is_active`. The robot that answers customers by
   *              itself. Unchanged from before 057, deliberately and to
   *              the letter: getting this wrong means a bot talking to
   *              customers on an account whose operator switched it off.
   *   'assist' → `assist_is_active`. The manual tools. They must survive
   *              the agent being turned off — that separation is the
   *              whole point of 057.
   *   'none'   → the Playground, so an admin can test the agent before
   *              flipping the master switch on.
   *
   * Pre-057 the column is absent and `assist_is_active` reads undefined.
   * It falls back to `is_active`, which is EXACTLY the old behaviour: on
   * a database without the migration the manual tools keep riding on the
   * agent's switch, as they always did. Defaulting it to false instead
   * would have taken a working feature away from anybody who had not
   * migrated yet.
   */
  if (gate === 'agent' && !row.is_active) return null
  if (gate === 'assist' && !(row.assist_is_active ?? row.is_active)) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    // The `??` only ever fires on the pre-049 fallback SELECT above,
    // because post-049 the column is NOT NULL DEFAULT TRUE. So this reads
    // "false until the migration is applied" — which is the right answer
    // for a window in which the feature could spend the account's tokens
    // and then have nowhere to put the result.
    mediaUnderstandingEnabled: row.media_understanding_enabled ?? false,

    // ---- 057: the manual tools, on their own switch ----------------
    //
    // Every `??` here fires only on a pre-057 fallback SELECT, and each
    // default is the behaviour that database actually has: the assist
    // master mirrors the agent's, audio and image mirror the single
    // `media_understanding_enabled` they were split out of, and document
    // reading — which did not exist before 057 — is off.
    assistIsActive: row.assist_is_active ?? row.is_active,
    assistModel: row.assist_model ?? null,
    transcribeAudioEnabled:
      row.transcribe_audio_enabled ?? row.media_understanding_enabled ?? false,
    describeImageEnabled:
      row.describe_image_enabled ?? row.media_understanding_enabled ?? false,
    readDocumentEnabled: row.read_document_enabled ?? false,

    // Post-053. Every `??` here fires only on a fallback SELECT, and
    // every default is what the code did before the migration: no
    // persona lines in the prompt, no tools, four chunks, assist off.
    //
    // `assistEnabled` defaults to FALSE rather than to the column's own
    // TRUE, for the same reason media understanding does: before the
    // migration the button would appear, spend the account's tokens, and
    // have no `assist_enabled` to have been checked against.
    personaName: row.persona_name ?? null,
    businessDescription: row.business_description ?? null,
    tone:
      row.tone === 'formal' || row.tone === 'neutral' || row.tone === 'casual'
        ? row.tone
        : null,
    guardrails: row.guardrails ?? null,
    escalationRules: row.escalation_rules ?? null,
    enabledTools: Array.isArray(row.enabled_tools) ? row.enabled_tools : [],
    retrievalTopK:
      typeof row.retrieval_top_k === 'number' && row.retrieval_top_k >= 0
        ? row.retrieval_top_k
        : 4,
    assistEnabled: row.assist_enabled ?? false,
    setupCompletedAt: row.setup_completed_at ?? null,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}

/**
 * The same config, seen from the assist side.
 *
 * `assistModel` is an override and nothing more, so rather than teaching
 * every assist call site to write `config.assistModel ?? config.model`
 * — four places today, and the fifth one is where somebody forgets —
 * the swap happens once, here, and the rest of the code keeps reading
 * plain `config.model`.
 *
 * Everything else is shared on purpose: one account, one provider, one
 * BYO key. See migration 057.
 */
export function forAssist(config: AiConfig): AiConfig {
  if (!config.assistModel) return config
  return { ...config, model: config.assistModel }
}
