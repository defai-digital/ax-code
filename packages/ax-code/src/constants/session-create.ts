import { DurableStoragePolicy } from "../storage/policy"

export const SESSION_CREATE_BUSY_RETRY = {
  attempts: 3,
  baseMs: 50,
  maxMs: 1_000,
} as const

// Cover every SQLite lock wait and maximum retry delay, plus response overhead.
// Prompt/shell acceptance retains its independent, shorter deadline.
export const SESSION_CREATE_TIMEOUT_MS =
  DurableStoragePolicy.busyTimeoutMs * SESSION_CREATE_BUSY_RETRY.attempts +
  SESSION_CREATE_BUSY_RETRY.maxMs * (SESSION_CREATE_BUSY_RETRY.attempts - 1) +
  5_000
