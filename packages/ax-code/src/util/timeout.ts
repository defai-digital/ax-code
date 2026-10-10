import { toError } from "./error-message"

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
//
// With `{ signal }` the sleep rejects with the signal's abort reason as soon
// as the signal aborts; the timer and listener are cleaned up on either
// outcome. Delays are clamped to the largest value Node's timers accept
// without emitting a TimeoutOverflowWarning.
export function sleep(ms: number, opts?: { unref?: boolean; signal?: AbortSignal }): Promise<void> {
  const { unref, signal } = opts ?? {}
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      },
      Math.min(ms, 2_147_483_647),
    )
    if (unref) timer.unref?.()
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message?: string,
  opts?: { unref?: boolean; error?: () => Error; onTimeout?: () => void },
): Promise<T> {
  // Manual race implementation so that a post-timeout rejection from
  // `promise` does not become an unhandled rejection. The previous
  // Promise.race pattern left the original promise unhandled once the
  // timer fired — if it later rejected (e.g. an LSP RPC that errored
  // after the tool already returned), Node would log an
  // `unhandledRejection` warning or crash with
  // `--unhandled-rejections=throw`.
  //
  // Keep the timer ref'd: callers await the timeout as a correctness boundary,
  // so it must remain capable of settling even when the wrapped promise owns no
  // event-loop handles. Unref'ing here makes a short-lived CLI exit with an
  // unsettled await instead of reporting the timeout (the same failure mode
  // documented for sleep() above). `opts.unref` exists only for embedded hosts
  // (the programmatic SDK), where the library must not hold the host's event
  // loop open — see withSdkTimeout in sdk/programmatic-impl.ts.
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      opts?.onTimeout?.()
      if (opts?.error) {
        try {
          reject(opts.error())
        } catch (e) {
          reject(toError(e))
        }
        return
      }
      reject(new Error(message ?? `Operation timed out after ${ms}ms`))
    }, ms)
    if (opts?.unref) timer.unref?.()
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
