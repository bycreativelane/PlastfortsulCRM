import { AiError, type AiUsage, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import { MAX_TOOL_ROUNDS } from '../tools'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  sumUsage,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

interface AnthropicResponse {
  content?: AnthropicBlock[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** A turn in the running transcript. Content is a string or a block list. */
type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown }

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 *
 * WITH TOOLS this loops the same way the OpenAI adapter does, in this
 * API's own shape: the model answers with `tool_use` blocks, the results
 * go back as a `user` turn of `tool_result` blocks, and `MAX_TOOL_ROUNDS`
 * bounds how many times that can happen.
 *
 * With no tools the request body is byte-identical to the pre-053 one.
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tools, onToolCall } =
    args

  const transcript: AnthropicMessage[] = normalizeForAnthropic(messages).map(
    (m) => ({ role: m.role, content: m.content })
  )

  const toolSchemas = tools?.length
    ? tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }))
    : undefined

  let usage: AiUsage | null = null

  for (let round = 0; ; round++) {
    let res: Response
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: transcript,
          ...(toolSchemas ? { tools: toolSchemas } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError('Anthropic', res)
    }

    const data = (await res.json().catch(() => null)) as AnthropicResponse | null

    // Anthropic reports input/output but no total — normalizeUsage sums.
    // Every round bills, so every round is added up.
    usage = sumUsage(
      usage,
      normalizeUsage({
        prompt: data?.usage?.input_tokens,
        completion: data?.usage?.output_tokens,
      })
    )

    const blocks = data?.content ?? []
    const toolUses = blocks.filter((b) => b.type === 'tool_use' && b.name)

    if (toolUses.length && onToolCall && round < MAX_TOOL_ROUNDS) {
      // The assistant turn goes back with ALL of its blocks, in order:
      // the API matches `tool_result` to `tool_use` by id, and a
      // transcript missing the call the result answers is rejected.
      transcript.push({ role: 'assistant', content: blocks })

      const results = []
      for (const use of toolUses) {
        const result = await onToolCall(
          use.name as string,
          (use.input ?? {}) as Record<string, unknown>
        )
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: result,
        })
      }
      transcript.push({ role: 'user', content: results })
      continue
    }

    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim()

    if (!text) {
      if (toolUses.length) {
        throw new AiError(
          'Anthropic kept calling tools without producing an answer.',
          { code: 'tool_loop' }
        )
      }
      throw new AiError('Anthropic returned an empty response.', {
        code: 'empty_response',
      })
    }

    return { text, usage }
  }
}
