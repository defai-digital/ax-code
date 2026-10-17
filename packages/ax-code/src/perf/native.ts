import { Flag } from "@/flag/flag"
import { FeatureFlag } from "@/util/feature-flags"

type Stat = {
  calls: number
  fails: number
  totalMs: number
  maxMs: number
  inBytes: number
  outBytes: number
}

type Row = Stat & {
  name: string
  avgMs: number
}

export type NativePerfSnapshot = {
  total: {
    calls: number
    fails: number
    totalMs: number
    inBytes: number
    outBytes: number
  }
  rows: Row[]
  operations?: OperationRow[]
}

type Phase = "admit" | "encode" | "queue" | "native" | "decode" | "format" | "fallback" | "total"
type Timing = { calls: number; fails: number; totalMs: number; maxMs: number; samples: number[] }
type TimingRow = Omit<Timing, "samples"> & { p50Ms: number; p95Ms: number; sampleCount: number }
type OperationRow = { name: string; phases: Partial<Record<Phase, TimingRow>> }
const operations = new Map<string, Partial<Record<Phase, Timing>>>()
const SAMPLE_LIMIT = 256

/** Numeric-only phase timing; never inspects or retains application payloads. */
export type NativeSpan = {
  start(phase: Phase): (failed?: boolean) => void
  run<T>(phase: Phase, fn: () => T): T
  runAsync<T>(phase: Phase, fn: () => Promise<T>): Promise<T>
}
function span(name: string): NativeSpan {
  const start = (phase: Phase) => {
    const began = performance.now()
    let ended = false
    return (failed = false) => {
      if (ended) return
      ended = true
      const elapsed = performance.now() - began
      const phases = operations.get(name) ?? {}
      const stat = phases[phase] ?? { calls: 0, fails: 0, totalMs: 0, maxMs: 0, samples: [] }
      stat.samples[stat.calls % SAMPLE_LIMIT] = elapsed
      stat.calls++
      stat.fails += Number(failed)
      stat.totalMs += elapsed
      stat.maxMs = Math.max(stat.maxMs, elapsed)
      phases[phase] = stat
      operations.set(name, phases)
    }
  }
  return {
    start,
    run(phase, fn) {
      const end = start(phase)
      try {
        const value = fn()
        end()
        return value
      } catch (error) {
        end(true)
        throw error
      }
    },
    async runAsync(phase, fn) {
      const end = start(phase)
      try {
        const value = await fn()
        end()
        return value
      } catch (error) {
        end(true)
        throw error
      }
    },
  }
}

const stats = new Map<string, Stat>()

let ready = false

function bytes(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value === "string") return Buffer.byteLength(value)
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return Buffer.byteLength(String(value))
  }
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + bytes(item), 0)
  if (typeof value === "object") {
    try {
      return Buffer.byteLength(JSON.stringify(value))
    } catch {
      return 0
    }
  }
  return 0
}

function record(name: string, input: unknown, output: unknown, elapsed: number, failed: boolean) {
  const prev = stats.get(name) ?? {
    calls: 0,
    fails: 0,
    totalMs: 0,
    maxMs: 0,
    inBytes: 0,
    outBytes: 0,
  }
  stats.set(name, {
    calls: prev.calls + 1,
    fails: prev.fails + (failed ? 1 : 0),
    totalMs: prev.totalMs + elapsed,
    maxMs: Math.max(prev.maxMs, elapsed),
    inBytes: prev.inBytes + bytes(input),
    outBytes: prev.outBytes + bytes(output),
  })
}

function formatMs(value: number) {
  return value.toFixed(2)
}

export namespace NativePerf {
  export function enabled() {
    return Flag.AX_CODE_PROFILE_NATIVE
  }

  export function run<T>(name: string, input: unknown, fn: () => T): T {
    if (!enabled()) return fn()

    const start = performance.now()

    try {
      const result = fn()
      record(name, input, result, performance.now() - start, false)
      return result
    } catch (error) {
      record(name, input, undefined, performance.now() - start, true)
      throw error
    }
  }

  // Async variant for awaited hot paths: run() would only measure the
  // synchronous time to create the promise, not the work behind it.
  export async function runAsync<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> {
    if (!enabled()) return fn()

    const start = performance.now()

    try {
      const result = await fn()
      record(name, input, result, performance.now() - start, false)
      return result
    } catch (error) {
      record(name, input, undefined, performance.now() - start, true)
      throw error
    }
  }

  // Separate from legacy bridge rows: nested phases must not inflate their totals.
  // Native phase means addon roundtrip (including libuv wait and marshalling), not CPU time.
  export async function operation<T>(name: string, fn: (span: NativeSpan | undefined) => Promise<T>): Promise<T> {
    if (!enabled()) return fn(undefined)
    const trace = span(name)
    return trace.runAsync("total", () => fn(trace))
  }

  export function snapshot(): NativePerfSnapshot & { operations: OperationRow[] } {
    const rows = [...stats.entries()]
      .map(([name, item]) => ({
        name,
        ...item,
        avgMs: item.calls === 0 ? 0 : item.totalMs / item.calls,
      }))
      .sort((a, b) => b.totalMs - a.totalMs)

    return {
      total: rows.reduce(
        (sum, item) => ({
          calls: sum.calls + item.calls,
          fails: sum.fails + item.fails,
          totalMs: sum.totalMs + item.totalMs,
          inBytes: sum.inBytes + item.inBytes,
          outBytes: sum.outBytes + item.outBytes,
        }),
        {
          calls: 0,
          fails: 0,
          totalMs: 0,
          inBytes: 0,
          outBytes: 0,
        },
      ),
      rows,
      operations: [...operations].map(([name, phases]) => ({
        name,
        phases: Object.fromEntries(
          Object.entries(phases).map(([phase, stat]) => {
            const sorted = [...stat.samples].sort((a, b) => a - b)
            const { samples, ...totals } = stat
            return [
              phase,
              {
                ...totals,
                sampleCount: samples.length,
                p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? 0,
                p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
              },
            ]
          }),
        ),
      })),
    }
  }

  export function render(value: NativePerfSnapshot = NativePerf.snapshot()) {
    if (!enabled()) return ""
    if (value.total.calls === 0 && (value.operations?.length ?? 0) === 0) return ""

    const head = [
      "native bridge profile",
      `calls=${value.total.calls}`,
      `fails=${value.total.fails}`,
      `total_ms=${formatMs(value.total.totalMs)}`,
      `in_bytes=${value.total.inBytes}`,
      `out_bytes=${value.total.outBytes}`,
    ].join(" ")

    const rows = value.rows.map(
      (item) =>
        `  ${item.name} calls=${item.calls} fails=${item.fails} total_ms=${formatMs(item.totalMs)} avg_ms=${formatMs(item.avgMs)} max_ms=${formatMs(item.maxMs)} in_bytes=${item.inBytes} out_bytes=${item.outBytes}`,
    )

    const phases = (value.operations ?? []).flatMap((operation) =>
      Object.entries(operation.phases).map(
        ([phase, stat]) =>
          `  operation=${operation.name} phase=${phase} calls=${stat.calls} fails=${stat.fails} total_ms=${formatMs(stat.totalMs)} max_ms=${formatMs(stat.maxMs)} recent_p50_ms=${formatMs(stat.p50Ms)} recent_p95_ms=${formatMs(stat.p95Ms)} samples=${stat.sampleCount}`,
      ),
    )
    return [head, ...rows, ...phases].join("\n")
  }

  export function flush(write = (text: string) => process.stderr.write(text)) {
    const text = render()
    if (!text) return
    write(text + "\n")
  }

  export function install(write = (text: string) => process.stderr.write(text)) {
    if (ready || !enabled()) return
    ready = true
    process.on("exit", () => {
      NativePerf.flush(write)
    })
  }

  export function enable(write = (text: string) => process.stderr.write(text)) {
    FeatureFlag.set("AX_CODE_PROFILE_NATIVE", "1")
    install(write)
  }

  export function reset() {
    stats.clear()
    operations.clear()
  }
}
