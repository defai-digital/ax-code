const SESSION_ENTRY_SYNC_RETRY_WINDOW_MS = 2_000
const SESSION_ENTRY_SYNC_RETRY_INITIAL_DELAY_MS = 75
const SESSION_ENTRY_SYNC_RETRY_MAX_DELAY_MS = 400

export interface SessionEntrySyncRetryState {
  readonly startedAtMs: number
  readonly nextDelayMs: number
}

function entrySyncNow() {
  if (typeof performance === "object" && typeof performance.now === "function") {
    return performance.now()
  }
  return Date.now()
}

export function createSessionEntrySyncRetryState(nowMs = entrySyncNow()): SessionEntrySyncRetryState {
  return {
    startedAtMs: nowMs,
    nextDelayMs: SESSION_ENTRY_SYNC_RETRY_INITIAL_DELAY_MS,
  }
}

export function nextSessionEntrySyncRetry(
  state: SessionEntrySyncRetryState,
  nowMs = entrySyncNow(),
): { delayMs: number; state: SessionEntrySyncRetryState } | undefined {
  const elapsedMs = Math.max(0, nowMs - state.startedAtMs)
  const remainingMs = SESSION_ENTRY_SYNC_RETRY_WINDOW_MS - elapsedMs
  if (remainingMs <= 0) return

  const delayMs = Math.max(0, Math.min(state.nextDelayMs, SESSION_ENTRY_SYNC_RETRY_MAX_DELAY_MS, remainingMs))

  return {
    delayMs,
    state: {
      startedAtMs: state.startedAtMs,
      nextDelayMs: Math.min(state.nextDelayMs * 2, SESSION_ENTRY_SYNC_RETRY_MAX_DELAY_MS),
    },
  }
}
