/**
 * Pure permission/question reply latch (ADR-047 deferred + runtime stability).
 *
 * Prevents double-submit while a reply is in flight, and re-arms when the
 * active request id changes (queued permission reuse of the same component).
 */

export type PermissionSubmitLatch = {
  /** True while a reply HTTP call is in flight. */
  submitting: boolean
  /** Request id the latch was last armed for (null before first request). */
  armedForId: string | null
}

export function createPermissionSubmitLatch(requestId: string | null = null): PermissionSubmitLatch {
  return { submitting: false, armedForId: requestId }
}

/**
 * When the visible request id changes, clear the submitting flag so a new
 * prompt is interactive even if the previous reply was mid-flight.
 */
export function armPermissionLatchForRequest(state: PermissionSubmitLatch, requestId: string): PermissionSubmitLatch {
  if (state.armedForId === requestId) return state
  return { submitting: false, armedForId: requestId }
}

/**
 * Attempt to begin a submit. Returns the next latch state, or null if a
 * submit is already in flight for this request.
 */
export function tryBeginPermissionSubmit(state: PermissionSubmitLatch, requestId: string): PermissionSubmitLatch | null {
  const armed = armPermissionLatchForRequest(state, requestId)
  if (armed.submitting) return null
  return { submitting: true, armedForId: requestId }
}

/** Clear submitting after success or failure (keep armedForId). */
export function endPermissionSubmit(state: PermissionSubmitLatch): PermissionSubmitLatch {
  if (!state.submitting) return state
  return { ...state, submitting: false }
}

export function canSubmitPermission(state: PermissionSubmitLatch, requestId: string): boolean {
  return tryBeginPermissionSubmit(state, requestId) !== null
}
