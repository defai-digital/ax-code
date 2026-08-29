/**
 * Retry pacing primitives extracted verbatim from event-pipeline.ts.
 *
 * Visible+online tabs probe quickly so the user sees connection recovery in
 * under a second of real outage; hidden/offline tabs back off further so a
 * backgrounded browser tab on a flaky link doesn't burn battery probing a dead
 * network every few seconds. The browser would throttle hidden-tab timers
 * anyway, but this keeps the intent explicit and shrinks server load from
 * idle tabs.
 */

import type { BackoffProfile } from "./types"

export type BackoffEnvironment = {
  offline: boolean
  hidden: boolean
}

export function computeBackoffDelay(failures: number, profile: BackoffProfile, env: BackoffEnvironment): number {
  if (failures <= 0) return 0
  // Offline: don't spin probing a dead network. Use the long cap and rely on
  // the interruptible wait to resolve early when the `online` event fires.
  // The cap is also a fallback for browsers that miss `online`.
  if (env.offline) return profile.capHiddenMs
  const cap = env.hidden ? profile.capHiddenMs : profile.capVisibleMs
  const exponent = Math.min(failures - 1, profile.maxExponent)
  return Math.min(cap, profile.baseMs * 2 ** exponent)
}

// Extract an HTTP status code from anywhere it might be hiding on the error
// object. The SDK's unwrap pattern stashes it on `.status`; raw fetch failures
// may carry `.response.status`; some SDKs also use `.code`. The SDK's lazy SSE
// client (createSseClient) throws plain Errors with the status only inside the
// message ("SSE failed: 404 Not Found") — parse that as a last resort.
export function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined
  const direct = (error as { status?: unknown }).status
  if (typeof direct === "number") return direct
  const fromResponse = (error as { response?: { status?: unknown } }).response?.status
  if (typeof fromResponse === "number") return fromResponse
  const message = (error as { message?: unknown }).message
  if (typeof message === "string") {
    const match = /\bSSE failed: (\d{3})\b/.exec(message)
    if (match) return Number(match[1])
  }
  return undefined
}

// 4xx errors don't recover from blind retry — wrong path, expired auth, bad
// request body. Keep retrying anyway (a remote reconfigure or reauth can fix
// the underlying problem) but at the long cap so we're not hammering the
// server at short intervals indefinitely. 408 (timeout) and 429 (rate limit)
// are retryable in spirit — let them through to the normal exponential path.
export function defaultIsPermanentHttpStatus(status: number): boolean {
  if (status < 400 || status >= 500) return false
  if (status === 408 || status === 429) return false
  return true
}
