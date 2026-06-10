import type { ModelMessage } from "ai"
import type { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"

// Per-message estimate cache. Serializing a message's content dominates the
// estimate cost, and this runs against the full history on every prompt
// step. Message objects are stable across steps (toModelMessages caches
// per-message conversions and treats results as immutable), so the object
// itself is a safe cache key; replaced objects simply miss and recompute.
const estimateCache = new WeakMap<ModelMessage, number>()

export function estimateRequestTokens(input: { system: string[]; messages: ModelMessage[] }) {
  let total = 0
  for (const item of input.system) {
    total += Token.estimate(item) + 4
  }
  for (const message of input.messages) {
    if (typeof message.content === "string") {
      total += Token.estimate(message.content) + 4
      continue
    }
    let estimate = estimateCache.get(message)
    if (estimate === undefined) {
      estimate = Token.estimate(JSON.stringify(message.content))
      estimateCache.set(message, estimate)
    }
    total += estimate + 4
  }
  return total
}

export function getLastUserInfo(messages: readonly MessageV2.WithParts[]): MessageV2.User | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.info.role === "user") {
      return message.info
    }
  }
  return undefined
}
