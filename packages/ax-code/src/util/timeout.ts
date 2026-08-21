// Resolve after `ms`. The timer is ref'd by default, matching
// `node:timers/promises` setTimeout, which the rest of the codebase uses.
//
// An unref'd timer here is a correctness hazard for any awaited sleep: if the
// sleep is the only pending work, Node treats the event loop as empty and
// exits, leaving the awaiting promise permanently unsettled. In a short-lived
// CLI process that surfaces as an immediate exit 13
// (ERR_UNSETTLED_TOP_LEVEL_AWAIT) with no output and no error — which is what
// `ax-code risk` did whenever two reads contended on the same storage key and
// FileLock.acquire had to poll.
//
// Pass `{ unref: true }` only for fire-and-forget background timers that
// genuinely must not hold the process open. Do not use it in a loop whose
// result someone awaits.
export function sleep(ms: number, opts?: { unref?: boolean }): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (opts?.unref) timer.unref?.()
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
    }, ms)
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
