import type { Event } from "@ax-code/sdk/v2"
import { createAppState, type AppState } from "./app-state"
import type { Action } from "./actions"
import { isQueuedAction } from "./actions"
import { createEventQueue } from "./event-queue"
import { mapEventToActions } from "./event-map"
import { reduceAppState } from "./reducer"

type Listener = () => void

export function createTuiStateStore(input: { initial?: Partial<AppState>; maxQueuedDeltas?: number } = {}) {
  const queue = createEventQueue({ maxDepth: input.maxQueuedDeltas })
  let state = createAppState({
    ...input.initial,
    eventQueue: queue.snapshot(),
  })
  let flushScheduled = false
  const listeners = new Set<Listener>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  function commit(actions: Action[]) {
    if (actions.length === 0) return
    let next = state
    for (const action of actions) {
      next = reduceAppState(next, action)
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
        queue.enqueue(action)
        commit([queueMetricsAction()])
        scheduleFlush()
        return
      }
      commit([...flushQueuedActions(), action])
    },
    dispatchEvent(event: Event) {
      const actions = mapEventToActions(event)
      if (actions.length === 0) return
      const immediate: Action[] = []
      let queued = false
      for (const action of actions) {
        if (isQueuedAction(action)) {
          queue.enqueue(action)
          queued = true
          continue
        }
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
  }
}
