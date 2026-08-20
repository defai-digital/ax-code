/**
 * Time-window batching for streaming part deltas (PERF-05).
 *
 * Providers emit many small text/reasoning deltas per turn. Publishing each
 * as its own bus event is wasteful; coalescing within a short window cuts
 * fan-out without delaying the final force-write on text-end / reasoning-end.
 */

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
  /** Flush immediately; returns a promise when work was pending. */
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

  const defaultSchedule = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms)
    id.unref?.()
    return { clear: () => clearTimeout(id) }
  }
  const schedule = input.schedule ?? defaultSchedule

  const flush = (): Promise<unknown> | undefined => {
    timer = undefined
    if (pending.size === 0) return undefined
    const entries = [...pending]
    pending.clear()
    return Promise.all(
      entries.map(([partID, batch]) =>
        Promise.resolve(
          input.publish({
            sessionID: input.sessionID,
            messageID: input.messageID,
            partID,
            field: "text",
            delta: batch.chunks.join(""),
            offset: batch.offset,
          }),
        ),
      ),
    )
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
