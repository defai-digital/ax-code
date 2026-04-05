import { Log } from "@/util/log"
import { EventLogID } from "./index"
import { EventQuery } from "./query"
import type { ReplayEvent } from "./event"
import type { SessionID } from "@/session/schema"

const log = Log.create({ service: "replay.recorder" })

export namespace Recorder {
  const sessions = new Map<string, { sequence: number }>()

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
    queueMicrotask(() => {
      EventQuery.insert({
        id,
        session_id: event.sessionID as SessionID,
        step_id: stepId,
        event_type: event.type,
        event_data: event,
        sequence: seq,
      })
    })
  }
}
