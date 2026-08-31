// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
/**
 * Which master switch a load is asking about (migration 057).
 *
 * The agent and the manual tools are two products sharing one API key,
 * and before 057 they shared one switch as well — so turning off the
 * robot that answers customers also turned off audio transcription for
 * the humans. `gate` is what makes them independent.
 */
export type AiGate = 'agent' | 'assist' | 'none'

export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search.
   *
   *  Also the fallback key for AUDIO on an Anthropic account — Anthropic
   *  has no audio input, and this field is an OpenAI key by definition.
   *  See `@/lib/ai/media-understanding`. */
  embeddingsApiKey: string | null
  /** Transcribe inbound audio and describe inbound images as they
   *  arrive (migration 049). Gated behind `isActive` like the rest. */
  mediaUnderstandingEnabled: boolean

  // ---- The structured half of the prompt (migration 053) ----------
  //
  // `systemPrompt` above is still appended verbatim; these are the
  // things people were writing INTO it, given their own fields so the
  // composer can order them and so a prohibition can be stated as a
  // prohibition. All nullable: an absent one contributes no line.
  personaName: string | null
  businessDescription: string | null
  tone: 'formal' | 'neutral' | 'casual' | null
  guardrails: string | null
  escalationRules: string | null
  /** Tool names this account turned on. See `@/lib/ai/tools`. */
  enabledTools: string[]
  /** How many knowledge chunks go in front of the model. 0 = none. */
  retrievalTopK: number
  /** Agents may ask for a suggested reply on a message. */
  assistEnabled: boolean

  // ---- The manual half, split out in migration 057 ----------------
  //
  // These are the tools a PERSON uses: a suggested reply they will edit,
  // words attached to an audio they would otherwise have to listen to,
  // a description of a photo so search and keyword triggers see
  // something where they see nothing today.
  //
  // None of them talks to a customer. That is why they get their own
  // master switch instead of riding on the agent's.

  /** Master switch for the manual tools. Independent of `isActive`. */
  assistIsActive: boolean
  /** Model for the manual tools. Null = the same one the agent uses. */
  assistModel: string | null
  /** Transcribe inbound audio. */
  transcribeAudioEnabled: boolean
  /** Describe inbound images. */
  describeImageEnabled: boolean
  /** Read inbound PDFs. Off by default — the most expensive of the three
   *  and the only one that can arrive twenty pages long unannounced. */
  readDocumentEnabled: boolean
  /** When somebody walked the setup wizard to the end. */
  setupCompletedAt: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
