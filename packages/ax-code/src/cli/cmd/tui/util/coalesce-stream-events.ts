/**
 * Merge high-frequency `message.part.delta` events that share the same
 * part/field so consumers (Solid store projection, process RPC) pay once
 * per flush window instead of once per token.
 *
 * Non-delta events flush any pending deltas first so ordering stays:
 *   earlier deltas → non-delta → later deltas
 */

export type StreamEventLike = {
  type?: string
  properties?: Record<string, unknown>
  [key: string]: unknown
}

export const DEFAULT_STREAM_DELTA_COALESCE_MS = 16

function isTextPartDelta(event: StreamEventLike): boolean {
  if (event.type !== "message.part.delta") return false
  const props = event.properties
  if (!props || typeof props !== "object") return false
  if (props.field !== "text") return false
  if (typeof props.partID !== "string") return false
  if (typeof props.messageID !== "string") return false
  if (typeof props.delta !== "string") return false
  return true
}

function deltaKey(event: StreamEventLike): string {
  const props = event.properties!
  const sessionID = typeof props.sessionID === "string" ? props.sessionID : ""
  return `${sessionID}\0${props.messageID}\0${props.partID}\0${props.field}`
}

function mergeDelta(into: StreamEventLike, from: StreamEventLike): StreamEventLike {
  const intoProps = into.properties!
  const fromProps = from.properties!
  return {
    ...into,
    properties: {
      ...intoProps,
      delta: String(intoProps.delta ?? "") + String(fromProps.delta ?? ""),
    },
  }
}

/**
 * Collapse a batch of stream events: consecutive or non-consecutive text
 * deltas for the same part/field are concatenated; order of non-delta events
 * relative to coalesced delta groups is preserved by flushing pending deltas
 * before each non-delta.
 */
export function coalesceStreamEvents<T extends StreamEventLike>(events: readonly T[]): T[] {
  if (events.length <= 1) return events.slice() as T[]

  const out: T[] = []
  // key -> index in `out` of the open delta group
  const open = new Map<string, number>()

  const flushOpen = () => {
    open.clear()
  }

  for (const event of events) {
    if (!isTextPartDelta(event)) {
      flushOpen()
      out.push(event)
      continue
    }
    const key = deltaKey(event)
    const existingIndex = open.get(key)
    if (existingIndex === undefined) {
      open.set(key, out.length)
      out.push(event)
      continue
    }
    out[existingIndex] = mergeDelta(out[existingIndex]!, event) as T
  }

  return out
}

export type StreamDeltaCoalescerOptions = {
  /** Max time to hold a delta before flush. Default 16ms. */
  windowMs?: number
  /** Flush callback. */
  emit: (events: StreamEventLike[]) => void
  schedule?: (fn: () => void, delayMs: number) => () => void
  now?: () => number
}

/**
 * Stateful coalescer for live streams. Buffers text deltas briefly and
 * flushes immediately on non-delta events (or when the window elapses).
 */
export function createStreamDeltaCoalescer(options: StreamDeltaCoalescerOptions) {
  const windowMs = options.windowMs ?? DEFAULT_STREAM_DELTA_COALESCE_MS
  const now = options.now ?? Date.now
  const schedule =
    options.schedule ??
    ((fn: () => void, delayMs: number) => {
      const timer = setTimeout(fn, delayMs)
      timer.unref?.()
      return () => clearTimeout(timer)
    })

  let buffer: StreamEventLike[] = []
  let cancelTimer: (() => void) | undefined
  let lastFlushAt = 0
  let disposed = false

  const flush = () => {
    cancelTimer?.()
    cancelTimer = undefined
    if (buffer.length === 0) return
    const events = coalesceStreamEvents(buffer)
    buffer = []
    lastFlushAt = now()
    if (events.length === 0) return
    options.emit(events)
  }

  const armTimer = () => {
    if (cancelTimer) return
    const elapsed = now() - lastFlushAt
    const delay = elapsed < windowMs ? Math.max(0, windowMs - elapsed) : windowMs
    cancelTimer = schedule(() => {
      cancelTimer = undefined
      flush()
    }, delay)
  }

  return {
    push(event: StreamEventLike) {
      if (disposed) {
        options.emit([event])
        return
      }
      if (!isTextPartDelta(event)) {
        buffer.push(event)
        flush()
        return
      }
      buffer.push(event)
      armTimer()
    },
    flush,
    dispose() {
      disposed = true
      flush()
    },
  }
}
