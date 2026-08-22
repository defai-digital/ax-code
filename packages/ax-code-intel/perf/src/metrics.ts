// Metric aggregation for the perf harness. Percentile semantics deliberately
// match src/perf.ts (floor index into the sorted sample) so numbers recorded
// through the in-package ring buffer and numbers aggregated here are
// directly comparable.

export type MetricLanguage = "ts" | "py" | "rust"

export type ScenarioResult = {
  scenario: string
  language: MetricLanguage
  serverId: string
  samples: number
  p50: number
  p95: number
  peakRssKb?: number
  hitRate?: number
  rpcCount?: number
  totalMs: number
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

export function summarizeDurations(durations: readonly number[]): {
  samples: number
  p50: number
  p95: number
  totalMs: number
} {
  const sorted = [...durations].sort((a, b) => a - b)
  return {
    samples: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    totalMs: sorted.reduce((sum, value) => sum + value, 0),
  }
}

// Ratio with an empty-denominator guard: returns undefined instead of NaN so
// a scenario with zero observations simply omits the metric.
export function ratio(numerator: number, denominator: number): number | undefined {
  if (denominator <= 0) return undefined
  return numerator / denominator
}

export function round(value: number): number {
  return Math.round(value * 100) / 100
}
