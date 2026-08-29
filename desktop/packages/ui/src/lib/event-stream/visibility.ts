/**
 * Browser-environment primitives extracted verbatim from event-pipeline.ts:
 * offline/hidden detection plus the interruptible inter-attempt wait.
 */

/** Window event the desktop shell fires on OS wake-from-sleep (powerMonitor.resume). */
export const SYSTEM_RESUME_EVENT = "openchamber:system-resume"

/**
 * Window event the UI dispatches to interrupt the reconnect backoff and force
 * an immediate reconnect attempt (e.g. a "retry now" action on the reconnect
 * banner). Handled exactly like `openchamber:system-resume`.
 */
export const SYNC_RETRY_NOW_EVENT = "openchamber:sync-retry-now"

export const isOffline = (): boolean =>
  typeof navigator === "object" && navigator !== null && navigator.onLine === false

export const isHidden = (): boolean => typeof document !== "undefined" && document.visibilityState !== "visible"

export type InterruptibleWaitOptions = {
  /**
   * When false, the wait is a plain timer (plus the abort signal) — used by
   * consumers that never subscribed to browser lifecycle events.
   */
  interruptSignals: boolean
}

/**
 * Wait between reconnect attempts. Resolves early when:
 *   - the browser fires `online` (network came back — probe immediately),
 *   - the desktop shell fires `openchamber:system-resume` (wake from sleep),
 *   - the UI fires `openchamber:sync-retry-now` (user asked to retry now),
 *   - the tab becomes visible (user came back — probe immediately),
 *   - the transport is being torn down (close aborts).
 * Otherwise resolves after `ms` like a plain timer.
 */
export function waitForRetry(ms: number, abort: AbortSignal, options: InterruptibleWaitOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    if (ms <= 0 || abort.aborted) {
      resolve()
      return
    }

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (options.interruptSignals && typeof globalThis.window !== "undefined") {
        globalThis.window.removeEventListener("online", onInterrupt)
        globalThis.window.removeEventListener("pageshow", onPageShowInterrupt)
        globalThis.window.removeEventListener(SYSTEM_RESUME_EVENT, onInterrupt)
        globalThis.window.removeEventListener(SYNC_RETRY_NOW_EVENT, onInterrupt)
      }
      if (options.interruptSignals && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityInterrupt)
      }
      abort.removeEventListener("abort", onInterrupt)
    }
    const onInterrupt = () => {
      cleanup()
      resolve()
    }
    const onVisibilityInterrupt = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        onInterrupt()
      }
    }
    // bfcache restore: the page is back, probe immediately. Not `{ once: true }`
    // so a non-persisted pageshow doesn't consume the listener.
    const onPageShowInterrupt = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      onInterrupt()
    }

    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(onInterrupt, ms)
    if (options.interruptSignals && typeof globalThis.window !== "undefined") {
      globalThis.window.addEventListener("online", onInterrupt, { once: true })
      globalThis.window.addEventListener("pageshow", onPageShowInterrupt)
      globalThis.window.addEventListener(SYSTEM_RESUME_EVENT, onInterrupt, { once: true })
      globalThis.window.addEventListener(SYNC_RETRY_NOW_EVENT, onInterrupt, { once: true })
    }
    if (options.interruptSignals && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityInterrupt)
    }
    abort.addEventListener("abort", onInterrupt, { once: true })
  })
}
