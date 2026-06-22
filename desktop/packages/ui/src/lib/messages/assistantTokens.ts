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
