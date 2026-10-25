/**
 * Time-window batching for streaming part deltas (PERF-05).
 *
 * Providers emit many small text/reasoning deltas per turn. Publishing each
 * as its own bus event is wasteful; coalescing within a short window cuts
 * fan-out without delaying the final force-write on text-end / reasoning-end.
 */
import { scheduleUnref } from "../util/timeout"

export type DeltaPublish = (input: {
  sessionID: string
  messageID: string
  partID: string
  field: "text"
  delta: string
  /** Accumulated text length before the first chunk of this batch. */
  offset?: number
}) => Promise<unknown> | unknown

export type DeltaBatcher = {
  /**
   * Buffer a delta. `offset` is the accumulated text length before this
   * delta; a flushed batch carries the offset of its first chunk (chunks
   * within a batch are contiguous by producer order).
   */
  push(partID: string, delta: string, offset?: number): void
  /**
   * Flush immediately. Resolves after this call's publishes and every earlier
   * in-flight publish have settled; returns `undefined` only when this call
   * queued nothing and nothing is in flight.
   */
  flush(): Promise<unknown> | undefined
}

export function createDeltaBatcher(input: {
  sessionID: string
  messageID: string
  /** Window in ms before a scheduled flush (default 16 ≈ one frame). */
  windowMs?: number
  publish: DeltaPublish
  onFlushError?: (error: unknown) => void
  /** Inject for tests. */
  schedule?: (fn: () => void, ms: number) => { clear: () => void }
}): DeltaBatcher {
  const windowMs = input.windowMs ?? 16
  const pending = new Map<string, { offset?: number; chunks: string[] }>()
  let timer: { clear: () => void } | undefined
  // Resolves after every publish queued so far settles. `undefined` means
  // nothing is in flight, so the next batch may publish synchronously and keep
  // the ordering of the caller's surrounding event flow.
  let inFlight: Promise<unknown> | undefined

  const schedule = input.schedule ?? scheduleUnref

  const flush = (): Promise<unknown> | undefined => {
    timer = undefined
    if (pending.size === 0) return inFlight
    const entries = [...pending]
    pending.clear()

    const publishBatch = () => {
      let asyncPublish = false
      // A synchronous throw from publish is converted into a rejection, so one
      // failing part neither skips the remaining parts (already removed from
      // `pending`) nor escapes the timer callback past onFlushError.
      const results = entries.map(([partID, batch]) => {
        let result: unknown
        try {
          result = input.publish({
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID,
            field: "text",
            delta: batch.chunks.join(""),
            offset: batch.offset,
          })
        } catch (error) {
          return Promise.reject(error)
        }
        if (!result || typeof (result as PromiseLike<unknown>).then !== "function") return undefined
        asyncPublish = true
        return Promise.resolve(result)
      })
      return { promise: Promise.all(results), asyncPublish }
    }

    // Chain onto earlier in-flight work so a later flush cannot publish ahead
    // of a batch that is still being delivered. An empty flush (above) then
    // still drains it instead of reporting success early.
    const delivery = inFlight
      ? { promise: inFlight.then(() => publishBatch().promise), asyncPublish: true }
      : publishBatch()
    if (delivery.asyncPublish) {
      // Never rejects: an unconsumed link cannot surface as an unhandled
      // rejection, and one failed batch cannot block the next one.
      const link = delivery.promise.then(
        () => undefined,
        () => undefined,
      )
      inFlight = link
      void link.then(() => {
        if (inFlight === link) inFlight = undefined
      })
    }
    return delivery.promise
  }

  return {
    push(partID: string, delta: string, offset?: number) {
      const existing = pending.get(partID)
      if (existing) existing.chunks.push(delta)
      else pending.set(partID, { offset, chunks: [delta] })
      if (!timer) {
        timer = schedule(() => {
          flush()?.catch((error) => input.onFlushError?.(error))
        }, windowMs)
      }
    },
    flush() {
      if (timer) {
        timer.clear()
        timer = undefined
      }
      return flush()
    },
  }
}
