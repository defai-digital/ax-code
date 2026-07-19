/**
 * Fan-out lifecycle utility for parallel member execution.
 * Encapsulates abort-controller chaining, timeout with unref, and error wrapping.
 * Shared between council.ts and arena.ts.
 */

export namespace FanOut {
  export interface RunConfig<T, R> {
    members: T[]
    timeoutMs: number
    abort: AbortSignal
    execute: (member: T, signal: AbortSignal, timer: NodeJS.Timeout) => Promise<R>
    /** Maximum number of members running in parallel (default: 3). */
    concurrency?: number
    /** Called after each member completes (success or failure) with progress info. */
    onMemberComplete?: (completed: number, total: number, member: T) => void
  }

  export interface MemberResult<R> {
    result?: R
    error?: string
  }

  /**
   * Execute a callback for each member with independent abort/timeout lifecycle.
   * - Bounded concurrency: at most `concurrency` (default 3) members run in parallel.
   * - Each member gets a local AbortController chained to the parent abort signal.
   * - Each member gets a setTimeout with .unref() for timeout.
   * - Proper cleanup in finally (clear timer, remove abort listener).
   * - Errors become `{ error: string }` results, never thrown.
   * - Optional `onMemberComplete` fires after each member finishes.
   */
  export async function run<T, R>(config: RunConfig<T, R>): Promise<MemberResult<R>[]> {
    const { members, concurrency = 3, onMemberComplete } = config
    const results: MemberResult<R>[] = new Array(members.length)
    let completed = 0
    let nextIndex = 0

    async function runNext(): Promise<void> {
      while (nextIndex < members.length) {
        const idx = nextIndex++
        const member = members[idx]
        results[idx] = await runOne(config, member)
        completed++
        onMemberComplete?.(completed, members.length, member)
      }
    }

    const requestedConcurrency = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 3
    const workers = Math.min(requestedConcurrency, members.length)
    await Promise.all(Array.from({ length: workers }, () => runNext()))
    return results
  }

  /** Run a single member with abort/timeout lifecycle. */
  async function runOne<T, R>(config: RunConfig<T, R>, member: T): Promise<MemberResult<R>> {
    const localAbort = new AbortController()
    const onParentAbort = () => localAbort.abort(config.abort.reason)
    if (config.abort.aborted) {
      localAbort.abort(config.abort.reason)
    } else {
      config.abort.addEventListener("abort", onParentAbort, { once: true })
    }
    const timer = setTimeout(() => localAbort.abort(), config.timeoutMs)
    timer.unref?.()
    try {
      const result = await config.execute(member, localAbort.signal, timer)
      return { result }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { error: localAbort.signal.aborted ? `aborted: ${message}` : message }
    } finally {
      clearTimeout(timer)
      config.abort.removeEventListener("abort", onParentAbort)
    }
  }
}
