import type { LanguageModelV2Usage } from "@ai-sdk/provider"

export const USAGE_SOURCE_KEY = "__axCodeUsageSource"

export type UsageSource = "exact" | "estimated" | "missing"

type UsageWithSource = LanguageModelV2Usage & {
  [USAGE_SOURCE_KEY]?: UsageSource
}

function tokenCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value && typeof value === "object" && "total" in value) {
    return tokenCount((value as { total: unknown }).total)
  }
  return 0
}

export function markEstimatedUsage<T extends object>(usage: T) {
  Object.defineProperty(usage, USAGE_SOURCE_KEY, {
    value: "estimated",
    enumerable: false,
    configurable: true,
  })
  return usage as T & { [USAGE_SOURCE_KEY]: "estimated" }
}

export function usageSource(usage: unknown): UsageSource {
  if (!usage || typeof usage !== "object") return "missing"

  const source = (usage as Partial<UsageWithSource>)[USAGE_SOURCE_KEY]
  if (source === "estimated") return "estimated"
  if (source === "exact") return "exact"

  const record = usage as Record<string, unknown>
  const input = tokenCount(record.inputTokens)
  const output = tokenCount(record.outputTokens)
  if (record.inputTokens == null && record.outputTokens == null && record.totalTokens == null) return "missing"
  const reasoning = tokenCount(record.reasoningTokens)
  const inputDetails = record.inputTokens as Record<string, unknown> | undefined
  const outputDetails = record.outputTokens as Record<string, unknown> | undefined
  const cacheRead = tokenCount(record.cachedInputTokens ?? inputDetails?.cacheRead)
  const cacheWrite = tokenCount(inputDetails?.cacheWrite)
  const outputReasoning = tokenCount(outputDetails?.reasoning)
  if (record.totalTokens == null && input + output + reasoning + cacheRead + cacheWrite + outputReasoning === 0) {
    return "missing"
  }
  return "exact"
}
