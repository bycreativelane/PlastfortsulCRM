import type { SupabaseClient } from '@supabase/supabase-js'

import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import { supabaseAdmin } from './admin-client'
import { forAssist, loadAiConfig } from './config'
import { AiError, type AiConfig, type AiUsage } from './types'
import { aiRequestTimeoutMs } from './defaults'
import {
  normalizeUsage,
  providerHttpError,
  toNetworkError,
} from './providers/shared'
import { logAiUsage } from './usage'

// ============================================================
// Words for the messages that have none.
//
// A voice note and a photograph arrive with `content_text` empty, and
// `content_text` is what the entire product downstream reads: the
// conversation list's preview, the global search, every keyword
// automation, the flow runner, the auto-reply's own eligibility gate.
// So "preciso de 200 unidades até sexta", said out loud, is a row
// reading `[audio]` that triggers nothing and is found by no search.
//
// This module produces the paragraph those readers need. It does not
// decide policy — `understandInboundMedia` below is the one entry point
// and it is called from the webhook's `after()` block, off Meta's clock,
// where it can fail without consequence.
//
// WHAT IT COSTS. Every call bills the account's own provider key, once
// per inbound audio or image. `ai_configs.media_understanding_enabled`
// (migration 049) is the switch, and `is_active` gates it as it gates
// everything else here. Both calls write to `ai_usage_log` under the new
// `transcription` / `vision` modes, so Configurações › IA shows the spend
// of the one AI surface that runs without anybody pressing a button.
// ============================================================

/** How big a file we will hand a provider, in bytes. */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions'
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * The transcription model, overridable with `AI_TRANSCRIBE_MODEL`.
 *
 * `whisper-1` rather than one of the newer ids: this runs on a key the
 * account brought, on whatever tier that key happens to be, and the one
 * failure mode worth designing away is "your voice notes stopped working
 * because we picked a model your account cannot call". Whisper is the
 * endpoint's oldest and most universally available model. An account that
 * wants the newer one says so in the environment.
 */
function transcribeModel(): string {
  return process.env.AI_TRANSCRIBE_MODEL?.trim() || 'whisper-1'
}

/**
 * What an image is asked to become.
 *
 * Deliberately not "describe this image". The reader is an agent
 * scanning an inbox for what a customer wants, and in this product a
 * customer's photograph is nearly always a document: a part with a
 * code stamped on it, a delivery note, a payment receipt, a damaged
 * box. Numbers and names on the thing are the whole value, and a
 * generic captioner returns "a photo of a metal component on a table".
 */
const IMAGE_PROMPT =
  'Descreva esta imagem para um atendente de CRM que não pode vê-la. ' +
  'Em português do Brasil, no máximo 3 frases. ' +
  'Comece pelo que a imagem É (documento, produto, comprovante, foto de local, print de tela). ' +
  'Transcreva LITERALMENTE qualquer texto, código, número de nota, valor ou placa visível — ' +
  'esses costumam ser a razão de a foto ter sido enviada. ' +
  'Não interprete intenção, não faça suposições e não invente nada que não esteja na imagem.'

const DOCUMENT_PROMPT =
  'Resuma este documento para um atendente de CRM que não pode abri-lo. ' +
  'Em português do Brasil, no máximo 5 frases. ' +
  'Comece pelo que o documento É (pedido, nota fiscal, boleto, contrato, ' +
  'tabela de preços, comprovante, proposta). ' +
  'Transcreva LITERALMENTE número do documento, valores, datas de ' +
  'vencimento, CNPJ e nomes de produto — é por isso que ele foi enviado. ' +
  'Se houver mais páginas do que cabem na resposta, diga quantas leu. ' +
  'Não interprete intenção e não invente nada que não esteja no arquivo.'

/** MIME families each provider can actually read. */
const AUDIO_MIME = /^audio\//i
const IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/i
/**
 * PDF ONLY, and that is not laziness.
 *
 * Both providers read a PDF natively — Anthropic as a `document` content
 * block, OpenAI as a `file` part — and neither reads .docx, .xlsx or the
 * .p7s a Brazilian NF-e arrives wrapped in. Matching `application/*`
 * broadly would mean uploading a spreadsheet, paying for the bytes and
 * getting a refusal back. Better to leave those `unsupported`, which is
 * a state the row already knows how to record.
 */
const DOCUMENT_MIME = /^application\/pdf$/i

export type MediaUnderstandingStatus = 'done' | 'failed' | 'unsupported'

export interface MediaUnderstandingResult {
  status: MediaUnderstandingStatus
  /** The words, when there are any. */
  text: string | null
  usage: AiUsage | null
  /** Which log mode this call belongs to; null when nothing was called. */
  mode: 'transcription' | 'vision' | null
}

// ------------------------------------------------------------------
// Audio
// ------------------------------------------------------------------

/**
 * Spoken words out of an audio file, through OpenAI's transcription
 * endpoint.
 *
 * OPENAI ONLY, and that is a limit of the world rather than a choice:
 * Anthropic's API has no audio input at the time of writing. An account
 * configured on Anthropic can still get transcripts, because the caller
 * falls back to `embeddingsApiKey` — which is documented in `types.ts`
 * as "an OpenAI-compatible key" and exists on exactly the accounts that
 * turned on semantic search. When there is no OpenAI key of either kind,
 * the answer is `unsupported`, not `failed`: nothing broke, the account
 * simply has not given us a key that can do this.
 *
 * `multipart/form-data`, built from a `Blob` — the endpoint takes a file
 * upload, not JSON, and this is the one place in the AI layer that is not
 * a JSON POST.
 */
export async function transcribeAudio(args: {
  apiKey: string
  bytes: Buffer
  mimeType: string
  timeoutMs?: number
}): Promise<{ text: string; usage: AiUsage | null }> {
  const { apiKey, bytes, mimeType } = args
  const timeoutMs = args.timeoutMs ?? aiRequestTimeoutMs()

  const form = new FormData()
  // The extension matters. OpenAI reads the FILENAME to decide the
  // container, and WhatsApp voice notes arrive as `audio/ogg; codecs=opus`
  // — sending them as `file` with no extension is rejected as an
  // unsupported format even though the bytes are fine.
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    `audio.${audioExtension(mimeType)}`
  )
  form.append('model', transcribeModel())
  // `text` rather than `json`: the response is one string either way, and
  // this spares a parse that can only fail.
  form.append('response_format', 'text')

  let res: Response
  try {
    res = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) throw await providerHttpError('OpenAI', res)

  const text = (await res.text()).trim()
  if (!text) {
    throw new AiError('OpenAI returned an empty transcription.', {
      code: 'empty_response',
    })
  }
  // The endpoint reports no token usage at all — it bills by audio
  // duration. `null` is the honest answer, and `logAiUsage` already
  // treats it as "nothing worth recording" rather than as zeros.
  return { text, usage: null }
}

/** Filename extension for a WhatsApp audio MIME type. */
function audioExtension(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  switch (base) {
    case 'audio/ogg':
    case 'audio/opus':
      return 'ogg'
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a'
    case 'audio/amr':
      return 'amr'
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav'
    case 'audio/webm':
      return 'webm'
    default:
      return 'ogg'
  }
}

// ------------------------------------------------------------------
// Images
// ------------------------------------------------------------------

/**
 * A paragraph describing an image, on whichever provider the account
 * configured — both read pictures, so unlike audio there is no fallback
 * to arrange.
 *
 * The image goes over as base64 rather than as a URL. Inbound media is
 * either behind Meta's short-lived authenticated CDN or in a
 * `chat-media` bucket, and handing a third party a link it may or may
 * not be able to fetch, later, is a class of failure that is invisible
 * until somebody reads a description of the wrong thing.
 */
export async function describeImage(args: {
  config: Pick<AiConfig, 'provider' | 'apiKey' | 'model'>
  bytes: Buffer
  mimeType: string
  timeoutMs?: number
}): Promise<{ text: string; usage: AiUsage | null }> {
  const { config, bytes, mimeType } = args
  const timeoutMs = args.timeoutMs ?? aiRequestTimeoutMs()
  const base64 = bytes.toString('base64')
  const media = mimeType.split(';')[0].trim().toLowerCase()

  const request: {
    url: string
    headers: Record<string, string>
    body: unknown
  } =
    config.provider === 'anthropic'
      ? {
          url: ANTHROPIC_URL,
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'Content-Type': 'application/json',
          },
          body: {
            model: config.model,
            max_tokens: 400,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: media,
                      data: base64,
                    },
                  },
                  { type: 'text', text: IMAGE_PROMPT },
                ],
              },
            ],
          },
        }
      : {
          url: OPENAI_CHAT_URL,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: {
            model: config.model,
            max_completion_tokens: 400,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: IMAGE_PROMPT },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${media};base64,${base64}` },
                  },
                ],
              },
            ],
          },
        }

  let res: Response
  try {
    res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(
      config.provider === 'anthropic' ? 'Anthropic' : 'OpenAI',
      res
    )
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[]
    content?: { type?: string; text?: string }[]
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
      input_tokens?: number
      output_tokens?: number
    }
  } | null

  const text =
    config.provider === 'anthropic'
      ? (data?.content
          ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('')
          .trim() ?? '')
      : (data?.choices?.[0]?.message?.content ?? '').trim()

  if (!text) {
    throw new AiError('The provider returned an empty description.', {
      code: 'empty_response',
    })
  }

  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens ?? data?.usage?.input_tokens,
    completion: data?.usage?.completion_tokens ?? data?.usage?.output_tokens,
    total: data?.usage?.total_tokens,
  })

  return { text, usage }
}

/**
 * Read a PDF that arrived on WhatsApp.
 *
 * A distributor gets pedidos, boletos and price tables as PDFs all day,
 * and today every one of them lands in the CRM as `[document]` — invisible
 * to search, to keyword automations, and to anybody scanning the list.
 *
 * SAME SHAPE AS `describeImage`, one content block different, because
 * that is the only thing that differs: Anthropic takes a `document`
 * source block, OpenAI a `file` part carrying a data URL. Everything
 * else — the timeout, the error mapping, the usage normalisation — is
 * the behaviour those two functions must not drift apart on.
 *
 * `max_tokens` is higher than the image path's 400. A photo has one
 * thing in it; an order has line items, and truncating the summary at
 * the third product is worse than not summarising at all.
 */
export async function readDocument(args: {
  config: Pick<AiConfig, 'provider' | 'apiKey' | 'model'>
  bytes: Buffer
  /** The name Meta sent, when it sent one. It is often the only place
   *  the document number appears. */
  filename?: string | null
  timeoutMs?: number
}): Promise<{ text: string; usage: AiUsage | null }> {
  const { config, bytes } = args
  const timeoutMs = args.timeoutMs ?? aiRequestTimeoutMs()
  const base64 = bytes.toString('base64')
  const name = args.filename?.trim() || 'documento.pdf'
  const prompt = `${DOCUMENT_PROMPT}

Nome do arquivo: ${name}`

  const request: {
    url: string
    headers: Record<string, string>
    body: unknown
  } =
    config.provider === 'anthropic'
      ? {
          url: ANTHROPIC_URL,
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'Content-Type': 'application/json',
          },
          body: {
            model: config.model,
            max_tokens: 900,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'document',
                    source: {
                      type: 'base64',
                      media_type: 'application/pdf',
                      data: base64,
                    },
                  },
                  { type: 'text', text: prompt },
                ],
              },
            ],
          },
        }
      : {
          url: OPENAI_CHAT_URL,
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: {
            model: config.model,
            max_completion_tokens: 900,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  {
                    type: 'file',
                    file: {
                      filename: name,
                      file_data: `data:application/pdf;base64,${base64}`,
                    },
                  },
                ],
              },
            ],
          },
        }

  let res: Response
  try {
    res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(
      config.provider === 'anthropic' ? 'Anthropic' : 'OpenAI',
      res
    )
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[]
    content?: { type?: string; text?: string }[]
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
      input_tokens?: number
      output_tokens?: number
    }
  } | null

  const text =
    config.provider === 'anthropic'
      ? (data?.content
          ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text)
          .join('')
          .trim() ?? '')
      : (data?.choices?.[0]?.message?.content ?? '').trim()

  if (!text) {
    throw new AiError('The provider returned an empty summary.', {
      code: 'empty_response',
    })
  }

  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens ?? data?.usage?.input_tokens,
    completion: data?.usage?.completion_tokens ?? data?.usage?.output_tokens,
    total: data?.usage?.total_tokens,
  })

  return { text, usage }
}

// ------------------------------------------------------------------
// The one entry point
// ------------------------------------------------------------------

export interface UnderstandArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  /** `messages.id` — the row the words are written back onto. */
  messageId: string
  config: AiConfig
  bytes: Buffer
  /** Meta's MIME type for the attachment. */
  mimeType: string | null
  /** The document's filename, when Meta sent one. Often the only place
   *  the order or invoice number appears. */
  filename?: string | null
  /** When the message being transcribed arrived. Used to check nothing
   *  newer has landed before the transcript overwrites the list preview. */
  createdAt?: string | null
}

/**
 * Turn one inbound attachment into words and store them.
 *
 * NEVER THROWS. It runs inside the webhook's `after()` block alongside
 * notifications, flows and automations, and an inbound message that
 * fails to persist because a transcription provider was down would be a
 * spectacularly bad trade. Every failure is caught, recorded on the row
 * as `failed`, and logged.
 *
 * The row is always written, including on failure. `media_transcript`
 * NULL alone cannot distinguish "we never tried", "the format is not
 * supported" and "we tried and it broke" — and those three want three
 * different things from a future retry sweep.
 */
export async function understandInboundMedia(
  args: UnderstandArgs
): Promise<MediaUnderstandingResult> {
  const { db, accountId, conversationId, messageId, config, bytes } = args
  const mimeType = args.mimeType?.trim() || ''

  const result = await run()
  await persist(result)
  return result

  async function run(): Promise<MediaUnderstandingResult> {
    if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) {
      return { status: 'unsupported', text: null, usage: null, mode: null }
    }

    try {
      if (AUDIO_MIME.test(mimeType)) {
        // Anthropic cannot hear. See `transcribeAudio` — the embeddings
        // key is an OpenAI key by definition, so it is the fallback.
        const key =
          config.provider === 'openai' ? config.apiKey : config.embeddingsApiKey
        if (!key) {
          return { status: 'unsupported', text: null, usage: null, mode: null }
        }
        const { text, usage } = await transcribeAudio({
          apiKey: key,
          bytes,
          mimeType,
        })
        return { status: 'done', text, usage, mode: 'transcription' }
      }

      if (IMAGE_MIME.test(mimeType)) {
        const { text, usage } = await describeImage({
          config,
          bytes,
          mimeType,
        })
        return { status: 'done', text, usage, mode: 'vision' }
      }

      if (DOCUMENT_MIME.test(mimeType)) {
        const { text, usage } = await readDocument({
          config,
          bytes,
          filename: args.filename ?? null,
        })
        // Logged as `vision` and not as a fourth mode: `ai_usage_log.mode`
        // has a CHECK constraint, and widening it is a migration. Reading
        // a PDF bills as image tokens on both providers anyway, so the
        // cost report stays honest — see 049.
        return { status: 'done', text, usage, mode: 'vision' }
      }

      // Video, .docx, stickers in odd formats. Not a failure — there is
      // nothing here any configured provider reads.
      return { status: 'unsupported', text: null, usage: null, mode: null }
    } catch (err) {
      console.error(
        '[media understanding] failed:',
        err instanceof Error ? err.message : err
      )
      return { status: 'failed', text: null, usage: null, mode: null }
    }
  }

  async function persist(r: MediaUnderstandingResult): Promise<void> {
    try {
      const { error } = await db
        .from('messages')
        .update({
          media_transcript: r.text,
          media_transcript_status: r.status,
          media_transcript_at: new Date().toISOString(),
        })
        .eq('id', messageId)
      if (error) {
        // Pre-049 the columns do not exist and this is the only symptom.
        // One line, not a thrown error: the message itself is already
        // safely stored and the feature is additive.
        console.error(
          '[media understanding] could not store transcript (is migration 049 applied?):',
          error.message
        )
        return
      }
    } catch (err) {
      console.error('[media understanding] store threw:', err)
      return
    }

    /**
     * AND THE ROW IN THE LIST, when this is still the newest message.
     *
     * Two things fall out of one small UPDATE, and both were reported as
     * separate complaints:
     *
     *   · The inbox preview says "Áudio" for every voice note, so twenty
     *     rows of audio look identical and say nothing. Now the row shows
     *     what was actually said.
     *   · `matchesSearch` reads `last_message_text`. Until now searching
     *     for a word somebody SPOKE found nothing, because the only copy
     *     of that word was on the message row.
     *
     * Guarded on still being the newest message: transcription runs at
     * the back of the webhook and a second message can land while a
     * provider is thinking. Overwriting the preview then would show an
     * older audio's words next to a newer message's timestamp.
     *
     * Best-effort throughout — the transcript is already safely on the
     * message, and this is a copy for a list.
     */
    if (r.status === 'done' && r.text?.trim()) {
      try {
        const { data: newer } = await db
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .gt('created_at', args.createdAt ?? new Date(0).toISOString())
          .limit(1)

        if (!newer?.length) {
          await db
            .from('conversations')
            .update({ last_message_text: r.text.trim() })
            .eq('id', conversationId)
        }
      } catch (err) {
        console.error('[media understanding] preview update failed:', err)
      }
    }

    if (r.mode && r.usage) {
      await logAiUsage(db, {
        accountId,
        conversationId,
        mode: r.mode,
        provider: config.provider,
        model: r.mode === 'transcription' ? transcribeModel() : config.model,
        usage: r.usage,
      })
    }
  }
}

// ------------------------------------------------------------------
// The webhook's door
// ------------------------------------------------------------------

export interface DispatchMediaArgs {
  accountId: string
  conversationId: string
  /** `messages.id` of the row just inserted. */
  messageId: string
  /** Meta's media id, for the download. */
  mediaId: string
  /** Meta's MIME type, as it came in on the webhook payload. */
  mimeType: string | null
  /** The account's WhatsApp access token, already decrypted. */
  accessToken: string
  /** Meta's filename for a document, when the payload carried one. */
  filename?: string | null
  /** `messages.created_at` of the row being transcribed. */
  createdAt?: string | null
}

/**
 * Transcribe or describe one freshly-arrived attachment.
 *
 * Called from the WhatsApp webhook's `after()` block. Same contract as
 * `dispatchInboundToAiReply` next door: it owns every gate and every
 * try/catch, and it NEVER throws. A voice note that could not be
 * transcribed is a voice note — the message itself was stored several
 * statements ago.
 *
 * Gates, any of which is a silent no-op:
 *   · the account has no AI config, or the master switch is off
 *   · `media_understanding_enabled` is off
 *   · Meta will not give us the bytes
 *
 * THE BYTES COME FROM META, not from `media_url`. That column holds
 * either a `chat-media` public URL (when the mirror is on) or the
 * relative proxy path `/api/whatsapp/media/<id>` (when it is not), and
 * the second of those is not fetchable from a server with no origin and
 * no session. Going to the source works in both configurations and is
 * one download either way.
 */
export async function dispatchInboundMediaUnderstanding(
  args: DispatchMediaArgs
): Promise<string | null> {
  const { accountId, conversationId, messageId, mediaId, accessToken } = args

  try {
    const db = supabaseAdmin()
    // `gate: 'assist'` — reading what arrived is for the ATTENDANT.
    // Before 057 this rode on the agent's master switch, so an account
    // that did not want a robot answering customers also got no audio
    // transcribed. Two unrelated decisions on one toggle.
    const config = await loadAiConfig(db, accountId, { gate: 'assist' })
    if (!config) return null

    // Nothing to send a provider that it could read — skip the download
    // entirely rather than paying for bytes we would discard.
    //
    // The per-KIND switch is checked HERE and not after the download,
    // because the cheapest version of "this feature is off" is the one
    // that never fetches the file. Audio, image and document are three
    // switches now: transcribing a minute of speech costs a fraction of
    // reading a photo, and a twenty-page PDF costs more than both.
    const mime = args.mimeType?.trim() ?? ''
    const wanted =
      (AUDIO_MIME.test(mime) && config.transcribeAudioEnabled) ||
      (IMAGE_MIME.test(mime) && config.describeImageEnabled) ||
      (DOCUMENT_MIME.test(mime) && config.readDocumentEnabled)
    if (!wanted) return null

    const info = await getMediaUrl({ mediaId, accessToken })
    if (info.fileSize != null && info.fileSize > MAX_MEDIA_BYTES) return null

    const { buffer } = await downloadMedia({
      downloadUrl: info.url,
      accessToken,
    })

    const result = await understandInboundMedia({
      db,
      filename: args.filename ?? null,
      accountId,
      conversationId,
      messageId,
      // The assist model, when the account set one (057).
      config: forAssist(config),
      createdAt: args.createdAt ?? null,
      bytes: buffer,
      // Meta's own header wins over the webhook payload's field: the
      // payload has been observed omitting the codec parameter that
      // decides which container a voice note is in.
      mimeType: info.mimeType || mime,
    })

    // THE WORDS GO BACK TO THE CALLER, and that return value is the
    // difference between storing a transcript and having one.
    //
    // Everything in the webhook that reads a message — keyword
    // automations, the auto-reply gate, the outbound webhook payload —
    // ran minutes ago against `content_text`, which for a voice note is
    // empty. This function is last in the handler on purpose (it is the
    // slowest thing there), so by the time the words exist, every
    // consumer has already decided there was nothing to say.
    //
    // Handing them back lets the webhook run the one narrow second pass
    // that was skipped for lack of text. Returned rather than dispatched
    // from here so this file keeps knowing nothing about automations.
    return result.status === 'done' ? result.text : null
  } catch (err) {
    console.error(
      '[media understanding] dispatch failed:',
      err instanceof Error ? err.message : err
    )
    return null
  }
}
