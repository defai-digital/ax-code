/**
 * Bounded concurrency for outbound work (STAB-04).
 *
 * Subsystems already cap themselves in isolation; composing many of them
 * under load can still exhaust FDs/memory. Named limiters give the runtime
 * a single place to bound file I/O and network fan-out.
 */

export type ConcurrencyLimiter = {
  /** Run `fn` after acquiring a permit; always releases on settle. */
  run<T>(fn: () => Promise<T>): Promise<T>
  /** Currently held permits. */
  active(): number
  /** Callers waiting for a free permit. */
  waiting(): number
  /** Configured maximum concurrent permits. */
  readonly max: number
}

/**
 * Create a FIFO semaphore that allows at most `max` concurrent `run` calls.
 * `max` is clamped to ≥ 1.
 */
export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  const limit = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 1
  let active = 0
  const waiters: Array<() => void> = []

  async function acquire(): Promise<void> {
    // Free slot: take a new permit.
    if (active < limit) {
      active += 1
      return
    }
    // Otherwise wait. When release() hands off, the permit is transferred —
    // the waiter must NOT increment again (that would exceed `max` if a
    // concurrent acquire races between decrement and waiter resume).
    await new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
  }

  function release(): void {
    const next = waiters.shift()
    if (next) {
      // Transfer the held permit to the next waiter without opening a gap
      // that a free-path acquire() could steal.
      next()
      return
    }
    active = Math.max(0, active - 1)
  }

  return {
    max: limit,
    active: () => active,
    waiting: () => waiters.length,
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

/**
 * Map an array with at most `concurrency` workers, preserving result order.
 * Shared implementation for skill discovery and other bulk fan-out.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const limit = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1
  const result = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      result[index] = await mapper(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return result
}

/** Process-wide outbound caps (not per-directory; intentionally global). */
export const OutboundLimits = {
  /** Parallel file system operations (reads, walks, stats). */
  fileIO: createConcurrencyLimiter(50),
  /** Parallel outbound network requests (HTTP, MCP transports, downloads). */
  network: createConcurrencyLimiter(20),
}
