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
}

const stats = new Map<string, Stat>()

let ready = false

function on(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "1" || value === "true"
}

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
    return on("AX_CODE_PROFILE_NATIVE")
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

  export function snapshot(): NativePerfSnapshot {
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
    }
  }

  export function render(value = NativePerf.snapshot()) {
    if (!enabled()) return ""
    if (value.total.calls === 0) return ""

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

    return [head, ...rows].join("\n")
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

  export function reset() {
    stats.clear()
  }
}
