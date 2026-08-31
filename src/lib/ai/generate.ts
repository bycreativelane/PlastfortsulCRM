import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { resolveTools, runTool, type ToolContext } from './tools'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
  /**
   * Where a tool call would run (migration 053). Omit it and the model
   * gets no tools at all, whatever `config.enabledTools` says — which is
   * the right default for any caller that has no conversation to scope a
   * lookup to, like the settings "test key" probe.
   */
  toolContext?: ToolContext
  /**
   * Names of the tools this generation actually called, appended as it
   * goes. The playground and the assist panel show it — "it looked up
   * the contact" is most of why an answer can be trusted.
   */
  onToolUsed?: (name: string) => void
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages, toolContext, onToolUsed } = args
  const timeoutMs = aiRequestTimeoutMs()

  // No context, no tools. A generation with nowhere to scope a lookup
  // must not be handed lookups — every tool in the registry answers
  // about ONE account and ONE contact, and there is no argument through
  // which the model could name a different one.
  const tools = toolContext ? resolveTools(config.enabledTools) : []

  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
    ...(tools.length && toolContext
      ? {
          tools,
          onToolCall: async (name: string, toolArgs: Record<string, unknown>) => {
            onToolUsed?.(name)
            return runTool(tools, toolContext, name, toolArgs)
          },
        }
      : {}),
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
