/**
 * Fan-out lifecycle utility for parallel member execution.
 * Encapsulates abort-controller chaining, timeout with unref, and error wrapping.
 * Shared between council.ts and arena.ts.
 */

export namespace FanOut {
  /** Preserve nested SDK transport diagnostics without exposing request bodies or headers. */
  export function describeError(error: unknown): string {
    const details: string[] = []
    const seen = new Set<unknown>()
    let current = error
    for (let depth = 0; current && depth < 5 && !seen.has(current); depth++) {
      seen.add(current)
      if (typeof current !== "object") {
        details.push(String(current).slice(0, 1000))
        break
      }
      const record = current as {
        message?: unknown
        name?: unknown
        statusCode?: unknown
        lastError?: unknown
        cause?: unknown
      }
      const message = typeof record.message === "string" ? record.message.trim() : ""
      const name = typeof record.name === "string" ? record.name : "Error"
      const status = typeof record.statusCode === "number" ? `HTTP ${record.statusCode}` : ""
      // Nested validation messages may embed model output. Only retain their
      // error class and HTTP status; the outer message is already user-facing.
      const detail = [(depth === 0 ? message || name : name).slice(0, 1000), status].filter(Boolean).join(" — ")
      if (!details.includes(detail)) details.push(detail)
      current = record.lastError ?? record.cause
    }
    return details.join(": ") || "Unknown member error"
  }

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
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      localAbort.abort()
    }, config.timeoutMs)
    timer.unref?.()
    let onAbort: (() => void) | undefined
    try {
      localAbort.signal.throwIfAborted()
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(localAbort.signal.reason)
        localAbort.signal.addEventListener("abort", onAbort, { once: true })
      })
      // Observe both promises so a late SDK rejection cannot become unhandled.
      // The callback may ignore its signal; never publish its late success.
      const execution = Promise.resolve().then(() => {
        localAbort.signal.throwIfAborted()
        return config.execute(member, localAbort.signal, timer)
      })
      const result = await Promise.race([execution, cancelled])
      localAbort.signal.throwIfAborted()
      return { result }
    } catch (err) {
      const message = describeError(err)
      // A timer-fired abort and a parent-signal abort surface identically
      // (AbortError), but they mean different things to the caller: one is a
      // per-member timeout the user can raise via config, the other is a
      // deliberate cancellation. Label them distinctly so reports don't blame
      // "timeout" for a user-initiated abort (or vice versa).
      if (timedOut) return { error: `timeout: member exceeded ${config.timeoutMs}ms` }
      return { error: localAbort.signal.aborted ? `aborted: ${message}` : message }
    } finally {
      clearTimeout(timer)
      if (onAbort) localAbort.signal.removeEventListener("abort", onAbort)
      config.abort.removeEventListener("abort", onParentAbort)
    }
  }
}
