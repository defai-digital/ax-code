import type { Event } from "@ax-code/sdk/v2"
import { createAppState, type AppState } from "./app-state"
import type { Action } from "./actions"
import { isQueuedAction } from "./actions"
import { createEventQueue } from "./event-queue"
import { mapEventToActions } from "./event-map"
import { reduceAppState } from "./reducer"

type Listener = () => void

export type StoreDebugEntry =
  | { kind: "dispatch"; time: number; action: string; queued: boolean }
  | { kind: "commit"; time: number; action: string; changed: boolean; durationMicros: number }
  | { kind: "burst"; time: number; windowMs: number; commits: number; topAction: string; topCount: number }

export type StoreDebugSnapshot = {
  entries: StoreDebugEntry[]
  counters: {
    dispatches: number
    commits: number
    bursts: number
  }
  queue: {
    pending: number
    dropped: number
    coalesced: number
  }
}

export type StoreDebugConfig = {
  ringBufferSize?: number
  // Fires when the commit rate for a single action type crosses the "obvious
  // loop" threshold inside a 500ms window. Runs synchronously inside commit()
  // — a tight sync loop that never yields can still notify via this callback
  // (which is why we use appendFileSync in the wired-up sink).
  onBurst?: (info: {
    time: number
    windowMs: number
    commits: number
    topAction: string
    topCount: number
  }) => void
}

// A single action firing this many times in BURST_WINDOW_MS == pathological.
// Legitimate traffic doesn't repeat the same action type >50 times per half
// second; streaming deltas go through the coalescing event queue and hit
// reducer as one batched flush.
const BURST_SAME_ACTION_THRESHOLD = 50
const BURST_WINDOW_MS = 500
// Wall-clock throttle so a long hang emits a handful of burst records rather
// than thousands. Uses Date.now() (monotonic inside a sync loop) so it still
// works when the event loop never yields.
const BURST_THROTTLE_MS = 5_000
const DEFAULT_RING_BUFFER_SIZE = 512

class RingBuffer<T> {
  private readonly capacity: number
  private readonly data: T[] = []
  private cursor = 0

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity | 0)
  }

  push(value: T) {
    if (this.data.length < this.capacity) {
      this.data.push(value)
      return
    }
    this.data[this.cursor] = value
    this.cursor = (this.cursor + 1) % this.capacity
  }

  snapshot(): T[] {
    if (this.data.length < this.capacity) return this.data.slice()
    return this.data.slice(this.cursor).concat(this.data.slice(0, this.cursor))
  }
}

export function createTuiStateStore(
  input: {
    initial?: Partial<AppState>
    maxQueuedDeltas?: number
    debug?: StoreDebugConfig
  } = {},
) {
  const queue = createEventQueue({ maxDepth: input.maxQueuedDeltas })
  let state = createAppState({
    ...input.initial,
    eventQueue: queue.snapshot(),
  })
  let flushScheduled = false
  const listeners = new Set<Listener>()

  const debug = input.debug
  const ring: RingBuffer<StoreDebugEntry> | undefined = debug
    ? new RingBuffer<StoreDebugEntry>(debug.ringBufferSize ?? DEFAULT_RING_BUFFER_SIZE)
    : undefined
  const counters = {
    dispatches: 0,
    commits: 0,
    bursts: 0,
  }
  // Sliding window of recent commits keyed by action type. Keeps just
  // timestamps per action so memory stays bounded relative to the window.
  const recentCommits = new Map<string, number[]>()
  let lastBurstAt = 0

  function record(entry: StoreDebugEntry) {
    if (!ring) return
    ring.push(entry)
  }

  function maybeDetectBurst(actionType: string, now: number) {
    if (!debug?.onBurst) return
    const window = recentCommits.get(actionType) ?? []
    const cutoff = now - BURST_WINDOW_MS
    let start = 0
    while (start < window.length && window[start]! < cutoff) start++
    const pruned = start === 0 ? window : window.slice(start)
    pruned.push(now)
    recentCommits.set(actionType, pruned)

    if (pruned.length < BURST_SAME_ACTION_THRESHOLD) return
    if (now - lastBurstAt < BURST_THROTTLE_MS) return

    lastBurstAt = now
    counters.bursts++
    const info = {
      time: now,
      windowMs: BURST_WINDOW_MS,
      commits: pruned.length,
      topAction: actionType,
      topCount: pruned.length,
    }
    record({ kind: "burst", ...info })
    try {
      debug.onBurst(info)
    } catch {
      // Instrumentation must never crash the reducer.
    }
  }

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  function commit(actions: Action[]) {
    if (actions.length === 0) return
    let next = state
    for (const action of actions) {
      const start = debug ? performanceNowMicros() : 0
      const before = next
      next = reduceAppState(next, action)
      if (debug) {
        const changed = next !== before
        counters.commits++
        const now = Date.now()
        record({
          kind: "commit",
          time: now,
          action: action.type,
          changed,
          durationMicros: performanceNowMicros() - start,
        })
        maybeDetectBurst(action.type, now)
      }
    }
    if (next === state) return
    state = next
    emit()
  }

  function queueMetricsAction(): Action {
    return {
      type: "queue.measured",
      metrics: queue.snapshot(),
    }
  }

  function flushQueuedActions(): Action[] {
    const queued = queue.flush()
    if (queued.length === 0) return []
    return [...queued, queueMetricsAction()]
  }

  function scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(() => {
      flushScheduled = false
      commit(flushQueuedActions())
    })
  }

  function recordDispatch(action: Action, queued: boolean) {
    if (!debug) return
    counters.dispatches++
    record({ kind: "dispatch", time: Date.now(), action: action.type, queued })
  }

  return {
    getSnapshot() {
      return state
    },
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispatch(action: Action) {
      if (isQueuedAction(action)) {
        recordDispatch(action, true)
        queue.enqueue(action)
        commit([queueMetricsAction()])
        scheduleFlush()
        return
      }
      recordDispatch(action, false)
      commit([...flushQueuedActions(), action])
    },
    dispatchEvent(event: Event) {
      const actions = mapEventToActions(event)
      if (actions.length === 0) return
      const immediate: Action[] = []
      let queued = false
      for (const action of actions) {
        if (isQueuedAction(action)) {
          recordDispatch(action, true)
          queue.enqueue(action)
          queued = true
          continue
        }
        recordDispatch(action, false)
        immediate.push(...flushQueuedActions(), action)
      }
      if (queued && immediate.length === 0) {
        immediate.push(queueMetricsAction())
        scheduleFlush()
      }
      commit(immediate)
    },
    flush() {
      commit(flushQueuedActions())
    },
    getDebugSnapshot(): StoreDebugSnapshot {
      return {
        entries: ring ? ring.snapshot() : [],
        counters: { ...counters },
        queue: queue.snapshot(),
      }
    },
  }
}

function performanceNowMicros() {
  // performance.now() is millis with sub-ms precision in Bun; multiply to
  // get microseconds so durationMicros is stable even for sub-millisecond
  // reducer runs.
  return Math.round(performance.now() * 1000)
}
