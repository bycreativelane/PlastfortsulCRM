import { AiError, type AiUsage, type ProviderResult } from '../types'
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

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAiResponse {
  choices?: {
    message?: { content?: string; tool_calls?: OpenAiToolCall[] }
    finish_reason?: string
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/** One entry in the running transcript we send back on each round. */
type OpenAiMessage = Record<string, unknown>

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 *
 * WITH TOOLS this becomes a loop rather than one call: the model may
 * answer with `tool_calls` instead of text, we run them, append the
 * results, and ask again. `MAX_TOOL_ROUNDS` bounds it — a model that
 * keeps calling tools is a model that will keep calling tools, and the
 * customer is waiting on the other end of a WhatsApp thread.
 *
 * With no tools the request body is byte-identical to the pre-053 one.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tools, onToolCall } =
    args

  const transcript: OpenAiMessage[] = [
    { role: 'system', content: systemPrompt },
    ...mergeConsecutive(messages),
  ]

  const toolSchemas = tools?.length
    ? tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    : undefined

  let usage: AiUsage | null = null

  for (let round = 0; ; round++) {
    let res: Response
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: transcript,
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          ...(toolSchemas ? { tools: toolSchemas } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError('OpenAI', res)
    }

    const data = (await res.json().catch(() => null)) as OpenAiResponse | null
    // Every round bills, so every round is added up. Reporting only the
    // last one would under-report a tool-using conversation by however
    // many rounds it took.
    usage = sumUsage(
      usage,
      normalizeUsage({
        prompt: data?.usage?.prompt_tokens,
        completion: data?.usage?.completion_tokens,
        total: data?.usage?.total_tokens,
      })
    )

    const message = data?.choices?.[0]?.message
    const calls = (message?.tool_calls ?? []).filter(
      (call) => call.function?.name
    )

    if (calls.length && onToolCall && round < MAX_TOOL_ROUNDS) {
      // The assistant turn has to go back verbatim, tool_calls included —
      // OpenAI rejects a `tool` message whose `tool_call_id` has no
      // matching call in the transcript.
      transcript.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: message?.tool_calls,
      })

      for (const call of calls) {
        const name = call.function?.name as string
        let parsed: Record<string, unknown> = {}
        try {
          parsed = call.function?.arguments
            ? JSON.parse(call.function.arguments)
            : {}
        } catch {
          // A model that emits invalid JSON for its own arguments gets
          // the tool run with none rather than the whole generation
          // aborted — most of these tools take no arguments anyway.
          parsed = {}
        }
        const result = await onToolCall(name, parsed)
        transcript.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        })
      }
      continue
    }

    const text = message?.content
    if (!text || typeof text !== 'string' || !text.trim()) {
      // A model out of tool rounds with nothing to say is the one case
      // worth naming separately: the answer is "it kept looking things
      // up", not "the provider is broken".
      if (calls.length) {
        throw new AiError(
          'OpenAI kept calling tools without producing an answer.',
          { code: 'tool_loop' }
        )
      }
      throw new AiError('OpenAI returned an empty response.', {
        code: 'empty_response',
      })
    }

    return { text, usage }
  }
}
