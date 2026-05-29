import { createFixtureCommandCenterState } from "../projection/replay"
import { createCommandCenterViewModel } from "../projection/view-model"
import { applyLiveRuntimeEvent } from "../runtime/live"

export type CommandCenterPerformanceSmokeOptions = {
  messageEvents?: number
  queueEvents?: number
  scheduledEvents?: number
  viewModelEvery?: number
  maxDurationMs?: number
  maxHeapDeltaBytes?: number
}

export type CommandCenterPerformanceSmokeResult = {
  appliedEvents: number
  durationMs: number
  heapDeltaBytes: number
  visibleMessages: number
  hiddenMessages: number
  visibleQueueItems: number
  hiddenQueueItems: number
  scheduledTasks: number
  withinBudget: boolean
  budgets: {
    maxDurationMs: number
    maxHeapDeltaBytes: number
  }
}

const DEFAULT_MESSAGE_EVENTS = 1_500
const DEFAULT_QUEUE_EVENTS = 1_200
const DEFAULT_SCHEDULED_EVENTS = 120
const DEFAULT_VIEW_MODEL_EVERY = 75
const DEFAULT_MAX_DURATION_MS = 5_000
const DEFAULT_MAX_HEAP_DELTA_BYTES = 128 * 1024 * 1024

export function runCommandCenterPerformanceSmoke(
  options: CommandCenterPerformanceSmokeOptions = {},
): CommandCenterPerformanceSmokeResult {
  const messageEvents = options.messageEvents ?? DEFAULT_MESSAGE_EVENTS
  const queueEvents = options.queueEvents ?? DEFAULT_QUEUE_EVENTS
  const scheduledEvents = options.scheduledEvents ?? DEFAULT_SCHEDULED_EVENTS
  const viewModelEvery = Math.max(1, options.viewModelEvery ?? DEFAULT_VIEW_MODEL_EVERY)
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  const maxHeapDeltaBytes = options.maxHeapDeltaBytes ?? DEFAULT_MAX_HEAP_DELTA_BYTES
  const state = createFixtureCommandCenterState()
  const sessionID = state.selectedSessionID
  let appliedEvents = 0
  let view = createCommandCenterViewModel(state)
  const startHeap = process.memoryUsage().heapUsed
  const start = performance.now()

  for (let index = 0; index < messageEvents; index++) {
    const messageID = `perf_msg_${index}`
    if (
      applyLiveRuntimeEvent(state, {
        type: "message.updated",
        properties: {
          info: {
            id: messageID,
            sessionID,
            role: index % 2 === 0 ? "user" : "assistant",
            createdAt: index,
          },
        },
      })
    ) {
      appliedEvents++
    }
    if (
      applyLiveRuntimeEvent(state, {
        type: "message.part.updated",
        properties: {
          part: {
            id: `perf_part_${index}`,
            messageID,
            type: "text",
            text: `High-frequency command-center event ${index}`,
          },
        },
      })
    ) {
      appliedEvents++
    }
    if (index % viewModelEvery === 0) view = createCommandCenterViewModel(state)
  }

  for (let index = 0; index < queueEvents; index++) {
    if (
      applyLiveRuntimeEvent(state, {
        type: "task.queue.updated",
        properties: {
          item: {
            id: `perf_queue_${index}`,
            projectID: "ax-code",
            directory: "/workspace/ax-code",
            sessionID,
            kind: index % 9 === 0 ? "review" : "prompt",
            status: queueStatus(index),
            priority: index % 5,
            position: index,
            title: `Performance queue item ${index}`,
            payload: {
              multiRunID: index % 4 === 0 ? `perf_multi_${Math.floor(index / 4)}` : undefined,
              multiRunCount: 4,
            },
            time: { created: index },
          },
        },
      })
    ) {
      appliedEvents++
    }
    if (index % viewModelEvery === 0) view = createCommandCenterViewModel(state)
  }

  for (let index = 0; index < scheduledEvents; index++) {
    if (
      applyLiveRuntimeEvent(state, {
        type: "scheduled.task.updated",
        properties: {
          task: {
            id: `perf_scheduled_${index}`,
            projectID: "ax-code",
            title: `Performance scheduled task ${index}`,
            prompt: "Review the branch",
            schedule: { type: "daily", time: "09:00" },
            status: index % 3 === 0 ? "paused" : "active",
            nextRunAt: Date.now() + index * 60_000,
          },
        },
      })
    ) {
      appliedEvents++
    }
    if (index % viewModelEvery === 0) view = createCommandCenterViewModel(state)
  }

  view = createCommandCenterViewModel(state)
  const durationMs = performance.now() - start
  const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - startHeap)

  return {
    appliedEvents,
    durationMs,
    heapDeltaBytes,
    visibleMessages: view.messages.length,
    hiddenMessages: view.messageHiddenCount,
    visibleQueueItems: view.queue.length,
    hiddenQueueItems: view.queueHiddenCount,
    scheduledTasks: view.scheduledTasks.length,
    withinBudget: durationMs <= maxDurationMs && heapDeltaBytes <= maxHeapDeltaBytes,
    budgets: {
      maxDurationMs,
      maxHeapDeltaBytes,
    },
  }
}

function queueStatus(index: number) {
  if (index % 37 === 0) return "blocked_permission"
  if (index % 29 === 0) return "waiting_for_idle"
  if (index % 17 === 0) return "running"
  if (index % 13 === 0) return "failed"
  return "queued"
}

if (import.meta.main) {
  const result = runCommandCenterPerformanceSmoke()
  console.log(JSON.stringify(result, null, 2))
  if (!result.withinBudget) {
    throw new Error(
      `Command-center performance smoke exceeded budget: ${Math.round(result.durationMs)}ms, ${result.heapDeltaBytes} bytes heap delta`,
    )
  }
}
