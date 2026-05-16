import { Log } from "@/util/log"
import { EventLogID } from "./index"
import { EventQuery } from "./query"
import type { ReplayEvent } from "./event"
import type { SessionID } from "@/session/schema"
import { DiagnosticLog } from "@/debug/diagnostic-log"

const log = Log.create({ service: "replay.recorder" })

export namespace Recorder {
  // Backstop cap that bounds memory if `end()` is skipped (process crash
  // between begin and end, or a buggy caller). The per-entry footprint is
  // tiny — `{ sequence: number }` ≈ 24 bytes — so we set the cap high
  // enough that legitimate concurrent sessions never trigger eviction.
  // Eviction here is begin-time-only (we don't promote on `emit`), so a
  // low cap could silently drop subsequent events for a long-running
  // active session whose entry happens to be the oldest by begin order.
  // Logging on eviction surfaces the case if it ever happens in practice
  // (BUG-010).
  const MAX_SESSIONS = 10_000
  const sessions = new Map<string, { sequence: number; token: number }>()

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
    const token = (sessions.get(sessionID)?.token ?? 0) + 1
    sessions.set(sessionID, { sequence: 0, token })
    while (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value
      if (oldest === undefined || oldest === sessionID) break
      sessions.delete(oldest)
      log.warn("evicting recorder session entry — likely indicates leaked sessions", {
        evictedSessionID: oldest,
        cap: MAX_SESSIONS,
        hint: "subsequent emit() calls for the evicted session will be silently dropped",
      })
    }
  }

  export async function end(sessionID: SessionID) {
    const state = sessions.get(sessionID)
    if (!state) return
    const endToken = state.token
    // One microtask tick lets any pending emit() calls that were queued
    // before end() fire first, then flush and delete atomically.
    await Promise.resolve()
    flush()
    if (sessions.get(sessionID)?.token === endToken) sessions.delete(sessionID)
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
