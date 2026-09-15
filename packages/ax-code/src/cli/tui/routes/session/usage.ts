import type { AssistantMessage, Message } from "@ax-code/sdk/v2"

export namespace Usage {
  export function total(msg: Pick<AssistantMessage, "tokens">) {
    if (msg.tokens.total) return msg.tokens.total
    return msg.tokens.input + msg.tokens.output + (msg.tokens.cache?.read ?? 0) + (msg.tokens.cache?.write ?? 0)
  }

  export function hasUsage(msg: Pick<AssistantMessage, "tokens">) {
    return total(msg) > 0 || msg.tokens.reasoning > 0
  }

  export function last(msgs: Message[]) {
    return msgs.findLast((msg): msg is AssistantMessage => msg.role === "assistant" && hasUsage(msg))
  }

  // Tokens of the message's most recent FINISHED step, from its step-finish
  // part. Message-level totals accumulate across every step of the turn, so
  // anything that wants "current context size" (the footer context gauge,
  // matching what the compactor compares against the budget) must use the
  // per-step value. Undefined when the message carries no step-finish part —
  // callers fall back to the message totals (accurate for single-step turns).
  export function lastStepTokens(parts: readonly unknown[]): AssistantMessage["tokens"] | undefined {
    for (let i = parts.length - 1; i >= 0; i--) {
      const value = parts[i]
      if (!value || typeof value !== "object") continue
      const part = value as { type?: unknown; tokens?: unknown }
      if (part.type !== "step-finish") continue
      const tokens = part.tokens
      if (!tokens || typeof tokens !== "object") return undefined
      const usage = tokens as Record<string, unknown>
      if (typeof usage.input !== "number" || typeof usage.output !== "number") return undefined
      const cache = usage.cache && typeof usage.cache === "object" ? (usage.cache as Record<string, unknown>) : {}
      return {
        total: typeof usage.total === "number" ? usage.total : undefined,
        input: usage.input,
        output: usage.output,
        reasoning: typeof usage.reasoning === "number" ? usage.reasoning : 0,
        cache: {
          read: typeof cache.read === "number" ? cache.read : 0,
          write: typeof cache.write === "number" ? cache.write : 0,
        },
      }
    }
    return undefined
  }
}
