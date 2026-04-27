import { Log } from "@/util/log"
import { EventLogID } from "./index"
import { EventQuery } from "./query"
import type { ReplayEvent } from "./event"
import type { SessionID } from "@/session/schema"
import { DiagnosticLog } from "@/debug/diagnostic-log"

const log = Log.create({ service: "replay.recorder" })

export namespace Recorder {
  const sessions = new Map<string, { sequence: number }>()

  // Pending events buffered between microtask flushes. Long sessions emit
  // thousands of events (one per tool call, llm output, step, etc); the
  // previous impl queued one microtask per event and did one INSERT per
  // event. Batching coalesces all emits within a single tick into one
  // multi-row INSERT, dramatically cutting SQLite write transactions.
  const pending: EventQuery.InsertEvent[] = []
  let flushScheduled = false

  function scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(flush)
  }

  function flush() {
    flushScheduled = false
    if (pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    try {
      EventQuery.insertMany(batch)
    } catch (error) {
      // On batch failure, fall back to per-event inserts so a single bad
      // event doesn't lose the whole batch. Per-event errors are logged.
      log.warn("batched replay event insert failed, falling back to per-event", {
        count: batch.length,
        error,
      })
      for (const event of batch) {
        try {
          EventQuery.insert(event)
        } catch (perEventError) {
          log.warn("failed to persist replay event", {
            sessionID: event.session_id,
            eventType: event.event_type,
            sequence: event.sequence,
            error: perEventError,
          })
        }
      }
    }
  }

  export function begin(sessionID: SessionID) {
    sessions.set(sessionID, { sequence: 0 })
  }

  export function end(sessionID: SessionID) {
    // Defer deletion so pending microtask-queued emits flush first
    queueMicrotask(() => sessions.delete(sessionID))
  }

  export function active(sessionID: SessionID): boolean {
    return sessions.has(sessionID)
  }

  export function emit(event: ReplayEvent) {
    const state = sessions.get(event.sessionID)
    if (!state) return
    const id = EventLogID.ascending()
    const seq = state.sequence++
    const stepId = event.stepIndex?.toString() ?? null
    DiagnosticLog.record(event, { id, sequence: seq })
    pending.push({
      id,
      session_id: event.sessionID as SessionID,
      step_id: stepId,
      event_type: event.type,
      event_data: event,
      sequence: seq,
    })
    scheduleFlush()
  }
}
