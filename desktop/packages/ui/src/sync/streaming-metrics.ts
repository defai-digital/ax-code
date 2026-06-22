/**
 * Streaming Metrics — per-session prefill latency and decode throughput tracking.
 *
 * Plain closure API (no Zustand store). The event pipeline calls the tracker
 * methods as events arrive; consumers read metrics via getMetrics/getAllMetrics.
 *
 * Metrics are isolated per session — multiple concurrent sessions (parent +
 * subagents) each have independent tracking state.
 */

export type MetricsPhase = "prefill" | "decoding" | "idle"

export interface StreamingMetrics {
  /** Time from session.status(busy) to first delta arrival (ms). Null until first delta. */
  prefillMs: number | null
  /** Estimated tokens per second during active decode. Uses a sliding window. */
  decodeTps: number
  /** Total delta events received for the current turn. */
  tokenCount: number
  /** Total delta bytes received for the current turn. */
  totalBytes: number
  /** Current lifecycle phase. */
  phase: MetricsPhase
  /** Timestamp when session became busy (ms since epoch). */
  startedAt: number | null
  /** Timestamp of the most recent delta (ms since epoch). */
  lastDeltaAt: number | null
}

const DEFAULT_METRICS: StreamingMetrics = {
  prefillMs: null,
  decodeTps: 0,
  tokenCount: 0,
  totalBytes: 0,
  phase: "idle",
  startedAt: null,
  lastDeltaAt: null,
}

/** Sliding window size for decode rate calculation (ms). */
const RATE_WINDOW_MS = 3_000

/** Minimum samples before reporting a non-zero decode rate. */
const MIN_SAMPLES_FOR_RATE = 3

type SessionState = {
  busyAt: number
  firstDeltaAt: number | null
  tokenCount: number
  totalBytes: number
  phase: MetricsPhase
  /** Ring buffer of recent delta timestamps for sliding-window rate calc. */
  deltaTimestamps: number[]
  lastDeltaAt: number | null
}

const MAX_RING_SIZE = 500

function createSessionState(busyAt: number): SessionState {
  return {
    busyAt,
    firstDeltaAt: null,
    tokenCount: 0,
    totalBytes: 0,
    phase: "prefill",
    deltaTimestamps: [],
    lastDeltaAt: null,
  }
}

function computeDecodeTps(state: SessionState, now: number): number {
  const timestamps = state.deltaTimestamps
  if (timestamps.length < MIN_SAMPLES_FOR_RATE) {
    return 0
  }

  const windowStart = now - RATE_WINDOW_MS

  // Find the first timestamp within the window using binary-ish scan from the end
  let startIdx = 0
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i] < windowStart) {
      startIdx = i + 1
      break
    }
  }

  const countInWindow = timestamps.length - startIdx
  if (countInWindow < MIN_SAMPLES_FOR_RATE) {
    return 0
  }

  const firstInWindow = timestamps[startIdx]
  const elapsed = now - firstInWindow
  if (elapsed <= 0) {
    return 0
  }

  return Math.round((countInWindow / elapsed) * 1000)
}

function toMetrics(state: SessionState): StreamingMetrics {
  const now = Date.now()
  return {
    prefillMs: state.firstDeltaAt !== null ? state.firstDeltaAt - state.busyAt : null,
    decodeTps: state.phase === "decoding" ? computeDecodeTps(state, now) : 0,
    tokenCount: state.tokenCount,
    totalBytes: state.totalBytes,
    phase: state.phase,
    startedAt: state.busyAt,
    lastDeltaAt: state.lastDeltaAt,
  }
}

export type MetricsTracker = {
  /** Called when session.status transitions to busy. */
  onSessionBusy: (sessionID: string) => void
  /** Called when a message.part.delta arrives. Pass byte length of the delta text. */
  onDelta: (sessionID: string, deltaBytes?: number) => void
  /** Called when session.status transitions to idle or error. */
  onSessionIdle: (sessionID: string) => void
  /** Get current metrics for a session. Returns default if no tracking state. */
  getMetrics: (sessionID: string) => StreamingMetrics
  /** Get all tracked session metrics as a Map. */
  getAllMetrics: () => Map<string, StreamingMetrics>
  /** Remove tracking state for a session (cleanup). */
  removeSession: (sessionID: string) => void
}

export function createMetricsTracker(): MetricsTracker {
  const sessions = new Map<string, SessionState>()

  const onSessionBusy = (sessionID: string): void => {
    // Reset state on new busy — each turn gets fresh metrics
    sessions.set(sessionID, createSessionState(Date.now()))
  }

  const onDelta = (sessionID: string, deltaBytes = 1): void => {
    let state = sessions.get(sessionID)
    if (!state) {
      // Delta arrived without a preceding busy event — create state retroactively
      state = createSessionState(Date.now())
      sessions.set(sessionID, state)
    }

    const now = Date.now()

    if (state.firstDeltaAt === null) {
      state.firstDeltaAt = now
    }

    state.phase = "decoding"
    state.tokenCount += 1
    state.totalBytes += deltaBytes
    state.lastDeltaAt = now

    // Append to ring buffer, evict oldest if over capacity
    state.deltaTimestamps.push(now)
    if (state.deltaTimestamps.length > MAX_RING_SIZE) {
      state.deltaTimestamps.splice(0, state.deltaTimestamps.length - MAX_RING_SIZE)
    }
  }

  const onSessionIdle = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.phase = "idle"
    }
  }

  const getMetrics = (sessionID: string): StreamingMetrics => {
    const state = sessions.get(sessionID)
    if (!state) {
      return { ...DEFAULT_METRICS }
    }
    return toMetrics(state)
  }

  const getAllMetrics = (): Map<string, StreamingMetrics> => {
    const result = new Map<string, StreamingMetrics>()
    for (const [sessionID, state] of sessions) {
      result.set(sessionID, toMetrics(state))
    }
    return result
  }

  const removeSession = (sessionID: string): void => {
    sessions.delete(sessionID)
  }

  return {
    onSessionBusy,
    onDelta,
    onSessionIdle,
    getMetrics,
    getAllMetrics,
    removeSession,
  }
}

// ---------------------------------------------------------------------------
// Module-level accessor for the active metrics tracker instance.
// ---------------------------------------------------------------------------

let activeTracker: MetricsTracker | null = null

export function setActiveMetricsTracker(tracker: MetricsTracker | null): void {
  activeTracker = tracker
}

export function getActiveMetricsTracker(): MetricsTracker | null {
  return activeTracker
}
