/**
 * Coalesce mid-stream `updatePart.force` writes for the same part ID (PERF-05).
 *
 * Tool state transitions (pending → running → completed) must stay ordered and
 * should call `forceImmediate`. Progress snapshots (e.g. growing text while
 * streaming) can share a short window so a turn with many deltas does not
 * issue one SQLite write per token chunk.
 *
 * The window is size-aware when `windowFor` is provided. The shared timer is
 * armed from the part that opens an idle window and is never extended by later
 * snapshots, so a continuous delta stream cannot postpone the flush. A later
 * part whose window is shorter than the time still remaining re-arms that
 * timer (shorten-only); the flush still writes every pending part. Computed
 * delays clamp to `[windowMs, 2000]`.
 */
import { scheduleUnref } from "../util/timeout"

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

const MAX_WINDOW_MS = 2000

export function createPartWriteBatcher<TPart extends { id: string }>(input: {
  write: (part: TPart) => Promise<unknown> | unknown
  windowMs?: number
  /** Delay for the part that arms (or shorten-rearms) the shared timer. */
  windowFor?: (part: TPart) => number
  /** Clock for shorten-only re-arm. Defaults to `performance.now`. */
  now?: () => number
  onError?: (error: unknown, partID: string) => void
  schedule?: (fn: () => void, ms: number) => { clear: () => void }
}): PartWriteBatcher<TPart> {
  // Coalesce progress snapshots over a longer window: each flush writes the
  // full accumulated text/reasoning payload, so flushing every 16ms turned a
  // long stream into ~60 SQLite upserts/sec of a growing blob (O(n^2) write
  // volume). The default 250ms keeps small parts durable ~4x/sec. `windowFor`
  // may stretch a large part toward 2s so rewrite bandwidth stays near 1 MiB/s.
  // The armed timer is only ever shortened, never extended. State transitions
  // still use forceImmediate so the final value is always persisted eagerly.
  const windowMs = input.windowMs ?? 250
  const now = input.now ?? (() => performance.now())
  const pending = new Map<string, TPart>()
  let timer: { clear: () => void } | undefined
  let armedAt = 0
  let armedFor = 0
  let chain: Promise<void> = Promise.resolve()

  const scheduleTimer = input.schedule ?? scheduleUnref

  const resolveWindow = (part: TPart): number => {
    if (!input.windowFor) return windowMs
    let raw: number
    try {
      raw = input.windowFor(part)
    } catch {
      return windowMs
    }
    if (!Number.isFinite(raw)) return windowMs
    if (raw < windowMs) return windowMs
    if (raw > MAX_WINDOW_MS) return MAX_WINDOW_MS
    return raw
  }

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
    // Nothing new to write: wait for in-flight work, but do not replay a
    // rejection that writeOne already reported through onError.
    if (pending.size === 0) return chain.catch(() => undefined)
    const parts = [...pending.values()]
    pending.clear()
    chain = chain
      .catch(() => undefined)
      .then(async () => {
        // The parts were already removed from `pending`, so a failure for one
        // must not drop the others; write them all and rethrow the first error.
        let failure: { error: unknown } | undefined
        for (const part of parts) {
          try {
            await writeOne(part)
          } catch (error) {
            failure ??= { error }
          }
        }
        if (failure) throw failure.error
      })
    return chain
  }

  const arm = (delay: number) => {
    armedAt = now()
    armedFor = delay
    // writeOne already reported the failure through onError; swallow the
    // re-thrown rejection so a timer-driven flush cannot become unhandled.
    timer = scheduleTimer(() => {
      void flushPending().catch(() => undefined)
    }, delay)
  }

  return {
    schedule(part) {
      pending.set(part.id, part)
      const delay = resolveWindow(part)
      if (!timer) {
        arm(delay)
        return
      }
      // Shorten-only. A longer window must not push the deadline out, or a
      // continuous stream of growing snapshots would never flush. A shorter
      // window (a small part arriving while a large part's window is open)
      // re-arms so it is not stuck behind the longer delay.
      const remaining = armedFor - (now() - armedAt)
      if (delay < remaining) {
        timer.clear()
        timer = undefined
        arm(delay)
      }
    },
    async forceImmediate(part) {
      // Drop any coalesced snapshot for this id so a concurrent window flush
      // cannot rewrite an older mid-stream value after this transition.
      pending.delete(part.id)
      // Nothing left to flush: release the armed timer so the next part arms
      // its own window instead of inheriting the remainder of a long one.
      if (pending.size === 0 && timer) {
        timer.clear()
        timer = undefined
      }
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
