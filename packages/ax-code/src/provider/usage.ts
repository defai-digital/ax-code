import type { LanguageModelV2Usage } from "@ai-sdk/provider"

export const USAGE_SOURCE_KEY = "__axCodeUsageSource"
const USAGE_SCOPE_KEY = "__axCodeUsageScope"
const CONTEXT_USAGE_KEY = "__axCodeContextUsage"

export type UsageSource = "exact" | "estimated" | "missing"
export type UsageScope = "request" | "run"
type ContextUsage = { input: number; output: number }

function metadata(usage: unknown, key: string): unknown {
  if (!usage || typeof usage !== "object") return undefined
  const record = usage as Record<string, unknown>
  if (record[key] !== undefined) return record[key]
  const raw = record.raw
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined
}

/** Scope is independent of accuracy: exact native run totals are not a prompt measurement. */
export function usageScope(usage: unknown): UsageScope {
  return metadata(usage, USAGE_SCOPE_KEY) === "run" ? "run" : "request"
}

export function usageContext(usage: unknown): ContextUsage | undefined {
  const value = metadata(usage, CONTEXT_USAGE_KEY)
  if (!value || typeof value !== "object") return undefined
  const { input, output } = value as Record<string, unknown>
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) return undefined
  if (typeof output !== "number" || !Number.isFinite(output) || output < 0) return undefined
  return { input, output }
}

/** Mirror provenance in raw because the AI SDK copies it when rebuilding usage. */
export function markRunUsage<T extends object>(usage: T, context: ContextUsage): T {
  const record = usage as Record<string, unknown>
  const raw = record.raw && typeof record.raw === "object" ? record.raw : {}
  for (const target of [usage, raw]) {
    Object.defineProperty(target, USAGE_SCOPE_KEY, { value: "run", configurable: true })
    Object.defineProperty(target, CONTEXT_USAGE_KEY, { value: Object.freeze({ ...context }), configurable: true })
  }
  if (record.raw !== raw) Object.defineProperty(usage, "raw", { value: raw, configurable: true })
  return usage
}

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

  // The AI SDK rebuilds usage (asLanguageModelUsage) into a fresh object, which
  // drops the non-enumerable top-level marker; it copies `raw` by reference, so
  // a model that cannot measure usage mirrors its marker there.
  const raw = (usage as { raw?: unknown }).raw
  if (raw && typeof raw === "object") {
    const rawSource = (raw as Partial<UsageWithSource>)[USAGE_SOURCE_KEY]
    if (rawSource === "estimated") return "estimated"
    if (rawSource === "exact") return "exact"
  }

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
