/**
 * Coalesce mid-stream `updatePart.force` writes for the same part ID (PERF-05).
 *
 * Tool state transitions (pending → running → completed) must stay ordered and
 * should call `forceImmediate`. Progress snapshots (e.g. growing text while
 * streaming) can share a short window so a turn with many deltas does not
 * issue one SQLite write per token chunk.
 */

export type PartWriteBatcher<TPart extends { id: string }> = {
  /** Schedule a force-write; later writes for the same id replace earlier ones. */
  schedule(part: TPart): void
  /** Flush one part immediately (state transitions). */
  forceImmediate(part: TPart): Promise<void>
  /** Flush all pending writes. */
  flush(): Promise<void>
  /** Number of parts waiting for the window flush. */
  pendingCount(): number
}

export function createPartWriteBatcher<TPart extends { id: string }>(input: {
  write: (part: TPart) => Promise<unknown> | unknown
  windowMs?: number
  onError?: (error: unknown, partID: string) => void
  schedule?: (fn: () => void, ms: number) => { clear: () => void }
}): PartWriteBatcher<TPart> {
  // Coalesce progress snapshots over a longer window: each flush writes the
  // full accumulated text/reasoning payload, so flushing every 16ms turned a
  // long stream into ~60 SQLite upserts/sec of a growing blob (O(n^2) write
  // volume). 250ms keeps progress durable ~4x/sec; state transitions still use
  // forceImmediate so the final value is always persisted eagerly.
  const windowMs = input.windowMs ?? 250
  const pending = new Map<string, TPart>()
  let timer: { clear: () => void } | undefined
  let chain: Promise<void> = Promise.resolve()

  const defaultSchedule = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms)
    id.unref?.()
    return { clear: () => clearTimeout(id) }
  }
  const scheduleTimer = input.schedule ?? defaultSchedule

  const writeOne = async (part: TPart) => {
    try {
      await input.write(part)
    } catch (error) {
      input.onError?.(error, part.id)
      throw error
    }
  }

  const flushPending = (): Promise<void> => {
    timer = undefined
    if (pending.size === 0) return chain
    const parts = [...pending.values()]
    pending.clear()
    chain = chain
      .catch(() => undefined)
      .then(async () => {
        for (const part of parts) {
          await writeOne(part)
        }
      })
    return chain
  }

  const arm = () => {
    if (timer) return
    timer = scheduleTimer(() => {
      void flushPending()
    }, windowMs)
  }

  return {
    schedule(part) {
      pending.set(part.id, part)
      arm()
    },
    async forceImmediate(part) {
      // Drop any coalesced snapshot for this id so a concurrent window flush
      // cannot rewrite an older mid-stream value after this transition.
      pending.delete(part.id)
      // Enqueue onto the shared chain (same as flushPending) so concurrent
      // forceImmediate / flush calls never run writeOne in parallel and part
      // state transitions stay ordered for Session.updatePart.force.
      const done = chain.catch(() => undefined).then(() => writeOne(part))
      chain = done
      await done
    },
    async flush() {
      if (timer) {
        timer.clear()
        timer = undefined
      }
      await flushPending()
    },
    pendingCount: () => pending.size,
  }
}
