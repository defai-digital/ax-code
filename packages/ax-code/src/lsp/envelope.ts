// AI-facing semantic results carry source/completeness/timestamp so downstream
// consumers can reason about staleness and partial results without parsing log
// lines. Source is "lsp" for live server data, "cache" for code_intel_lsp_cache
// hits, and "graph" for persistent code-graph index results.
export type SemanticEnvelope<T> = {
  data: T
  source: "lsp" | "cache" | "graph"
  completeness: "full" | "partial" | "empty"
  timestamp: number
  serverIDs: string[]
  cacheKey?: string
  degraded?: boolean
}

export type Freshness = "fresh" | "warm" | "stale"

const FRESH_THRESHOLD_MS = 60 * 1000
const WARM_THRESHOLD_MS = 24 * 60 * 60 * 1000

export function freshness(envelope: { timestamp: number }, now: number = Date.now()): Freshness {
  const age = now - envelope.timestamp
  if (age < FRESH_THRESHOLD_MS) return "fresh"
  if (age < WARM_THRESHOLD_MS) return "warm"
  return "stale"
}

export function participantStatus(input: { participatingServerIDs: string[]; failures: number }): {
  completeness: SemanticEnvelope<unknown>["completeness"]
  degraded: boolean
} {
  const completeness: SemanticEnvelope<unknown>["completeness"] =
    input.participatingServerIDs.length === 0 ? "empty" : input.failures === 0 ? "full" : "partial"
  return {
    completeness,
    degraded: input.failures > 0 || input.participatingServerIDs.length === 0,
  }
}
