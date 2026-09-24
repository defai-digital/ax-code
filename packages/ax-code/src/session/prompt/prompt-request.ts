import type { ModelMessage } from "ai"
import type { MessageV2 } from "../message-v2"
import { TokenEstimate } from "@/provider/token-estimate"

// Estimation math lives in provider/token-estimate (ADR-139 D5: one estimator
// for preflight, context status, memory/stats, and the token ledger). These
// wrappers keep the existing call sites and exports intact.

export function estimateRequestTokens(input: { system: string[]; messages: ModelMessage[] }) {
  return TokenEstimate.requestTokens(input)
}

export function estimateToolDefinitionTokens(
  tools: Iterable<{ id: string; description?: string; inputSchema: unknown }>,
) {
  return TokenEstimate.toolSchemaTokens(tools)
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
