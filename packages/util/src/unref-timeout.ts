// Shared by @ax-code/ax-code-intel and @ax-code/ax-code-reason, which both
// need timers that must not hold a short-lived process open. This is the
// unref'd variant on purpose: `packages/util/src/timeout.ts` keeps its timers
// ref'd because the CLI awaits those sleeps as a correctness boundary. Do not
// merge the two — the timer lifetime is the contract.

// Node fires a delay above 2^31-1 ms (including Infinity) after ~1 ms, so a
// long or "never" deadline would expire at once. Same clamp as timeout.ts.
const MAX_TIMER_DELAY_MS = 2_147_483_647
function clampDelay(ms: number) {
  if (Number.isNaN(ms)) return 0
  return Math.min(Math.max(ms, 0), MAX_TIMER_DELAY_MS)
}

// Resolve after `ms`, with the timer unref'd so a pending sleep never keeps
// the process alive (e.g. a lock poll loop during shutdown).
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, clampDelay(ms))
    timer.unref?.()
  })
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  // Manual race implementation so that a post-timeout rejection from
  // `promise` does not become an unhandled rejection. The previous
  // Promise.race pattern left the original promise unhandled once the
  // timer fired — if it later rejected (e.g. an LSP RPC that errored
  // after the tool already returned), Node would log an
  // `unhandledRejection` warning or crash with
  // `--unhandled-rejections=throw`.
  //
  // The timer is unref'd so a pending timeout never alone keeps the process
  // alive during shutdown (same pattern as sleep()).
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(message ?? `Operation timed out after ${ms}ms`))
    }, clampDelay(ms))
    timer.unref?.()
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
