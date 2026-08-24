import type { SessionContextUsage } from "@/stores/types/sessionTypes"

export type AssistantTokens = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

type AssistantTokenMessage = {
  id?: string
  role?: unknown
  tokens?: AssistantTokens
}

export const getAssistantTokenTotal = (tokens: AssistantTokens): number =>
  tokens.input + tokens.output + tokens.reasoning + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)

export const findLatestAssistantTokenUsage = (
  messages: readonly unknown[],
): { tokens: AssistantTokens; messageId?: string } | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as AssistantTokenMessage
    if (message.role !== "assistant") {
      continue
    }

    const tokens = message.tokens
    if (!tokens || getAssistantTokenTotal(tokens) <= 0) {
      continue
    }

    return { tokens, messageId: message.id }
  }

  return null
}

// Tokens of a message's most recent FINISHED step, from its step-finish
// parts. Assistant message token totals accumulate across every step of the
// turn (each tool-calling loop re-sends the full context), so the message
// totals overstate the current context size by roughly the step count.
// Returns null when no step-finish part exists — callers fall back to the
// message totals, which agree on single-step turns.
export const findLatestStepTokenUsage = (parts: readonly unknown[]): AssistantTokens | null => {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index] as { type?: unknown; tokens?: unknown } | null
    if (!part || part.type !== "step-finish") {
      continue
    }

    const tokens = part.tokens as AssistantTokens | undefined
    if (!tokens || typeof tokens.input !== "number" || typeof tokens.output !== "number") {
      return null
    }
    return {
      input: tokens.input,
      output: tokens.output,
      reasoning: typeof tokens.reasoning === "number" ? tokens.reasoning : 0,
      cache: {
        read: typeof tokens.cache?.read === "number" ? tokens.cache.read : 0,
        write: typeof tokens.cache?.write === "number" ? tokens.cache.write : 0,
      },
    }
  }

  return null
}

export const buildSessionContextUsage = (
  tokens: AssistantTokens,
  limits: {
    contextLimit: number
    outputLimit: number
    lastMessageId?: string
  },
): SessionContextUsage => {
  const totalTokens = getAssistantTokenTotal(tokens)
  const thresholdLimit = limits.contextLimit > 0 ? limits.contextLimit : 200000
  const percentage = limits.contextLimit > 0 ? Math.round((totalTokens / limits.contextLimit) * 100) : 0
  const normalizedOutput = limits.outputLimit > 0 ? Math.round((tokens.output / limits.outputLimit) * 100) : undefined

  return {
    totalTokens,
    percentage,
    contextLimit: limits.contextLimit || 0,
    outputLimit: limits.outputLimit || undefined,
    normalizedOutput,
    thresholdLimit,
    lastMessageId: limits.lastMessageId,
  }
}
