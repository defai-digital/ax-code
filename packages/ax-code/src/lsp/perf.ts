import { Log } from "../util/log"

const log = Log.create({ service: "lsp" })

// Bounded ring of recent durations per LSP operation. Perf diagnostics
// snapshot this to attribute orchestration/RPC cost at the operation level
// without retaining session-long history.
const PERF_SAMPLE_CAP = 1024

type PerfEntry = {
  durations: number[]
  cursor: number
  okCount: number
  errorCount: number
}

const perfSamples = new Map<string, PerfEntry>()

export type PerfRow = {
  count: number
  okCount: number
  errorCount: number
  p50: number
  p95: number
  maxMs: number
  totalMs: number
}

export function recordSample(operation: string, durationMs: number, ok: boolean) {
  let entry = perfSamples.get(operation)
  if (!entry) {
    entry = { durations: [], cursor: 0, okCount: 0, errorCount: 0 }
    perfSamples.set(operation, entry)
  }
  if (entry.durations.length < PERF_SAMPLE_CAP) {
    entry.durations.push(durationMs)
  } else {
    entry.durations[entry.cursor] = durationMs
    entry.cursor = (entry.cursor + 1) % PERF_SAMPLE_CAP
  }
  if (ok) entry.okCount++
  else entry.errorCount++
}

export function finishPhase(operation: string, started: number, ok: boolean) {
  const durationMs = Math.round(performance.now() - started)
  recordSample(operation, durationMs, ok)
  return durationMs
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

export function snapshot(): Record<string, PerfRow> {
  const out: Record<string, PerfRow> = {}
  for (const [op, entry] of perfSamples) {
    const sorted = [...entry.durations].sort((a, b) => a - b)
    const totalMs = sorted.reduce((s, v) => s + v, 0)
    out[op] = {
      count: entry.okCount + entry.errorCount,
      okCount: entry.okCount,
      errorCount: entry.errorCount,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      maxMs: sorted.at(-1) ?? 0,
      totalMs,
    }
  }
  return out
}

export function reset() {
  perfSamples.clear()
}

export async function metered<T>(operation: string, extra: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    const result = await fn()
    const durationMs = Math.round(performance.now() - started)
    recordSample(operation, durationMs, true)
    log.info("lsp.perf", {
      operation,
      durationMs,
      status: "ok",
      ...extra,
    })
    return result
  } catch (err) {
    const durationMs = Math.round(performance.now() - started)
    recordSample(operation, durationMs, false)
    log.warn("lsp.perf", {
      operation,
      durationMs,
      status: "error",
      errorCode: err instanceof Error ? err.name : "unknown",
      ...extra,
    })
    throw err
  }
}
