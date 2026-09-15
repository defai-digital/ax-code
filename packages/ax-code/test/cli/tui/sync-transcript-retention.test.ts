import { describe, expect, test, vi } from "vitest"
import { createStore, produce } from "solid-js/store"
import { createHeadlessProjectionState } from "../../../src/runtime/headless/projection"
import { subscribeStoreBackedSyncEvents } from "../../../src/cli/tui/context/sync-subscription"
import { applySessionLeavePrune, applySessionSyncSnapshot } from "../../../src/cli/tui/context/sync-session-store"

import type { SyncedSessionRisk } from "../../../src/cli/tui/context/sync-session-risk"

type Message = { id: string; sessionID: string }
type Part = { id: string; sessionID: string; messageID: string; type: "text"; text: string }
function fixture() {
  const initial = createHeadlessProjectionState<
    { id: string },
    unknown,
    unknown,
    unknown,
    Message,
    Part,
    SyncedSessionRisk
  >()
  const [state, setStore] = createStore({
    ...initial,
    message_truncated: {},
    message_memory_limited: {},
    message_reload: {},
  })
  let active: string | undefined = "active"
  let generation = 0
  let listener: (event: { details: unknown }) => void = () => {}
  const stop = subscribeStoreBackedSyncEvents<{ id: string }, unknown, unknown, unknown, Message, Part, typeof state>({
    listen(handler) {
      listener = handler
      return () => {}
    },
    getAutonomous: () => false,
    getActiveSessionID: () => active,
    getTranscriptGeneration: () => generation,
    setStore,
    clearSessionSyncState: () => {},
    replyPermission: () => {},
    replyQuestion: () => {},
    syncMcpStatus: () => {},
    syncLspStatus: () => {},
    syncDebugEngine: () => {},
    bootstrap: () => {},
    onWarn: () => {},
    onHandlerError(error) {
      throw new Error(error.error)
    },
    maxSessionMessages: 100,
  })
  const emit = (details: unknown) => listener({ details })
  const message = (sessionID: string, id: string) =>
    emit({ type: "message.updated", properties: { info: { id, sessionID } } })
  const part = (sessionID: string, id: string, text: string) =>
    emit({
      type: "message.part.updated",
      properties: { part: { id: `part_${id}`, sessionID, messageID: id, type: "text", text } },
    })
  return {
    state,
    setStore,
    stop,
    emit,
    message,
    part,
    activate(sessionID?: string) {
      active = sessionID
      generation++
    },
  }
}

describe("viewed transcript admission", () => {
  test("background transcripts stay absent while approvals and live status survive", () => {
    const f = fixture()
    try {
      for (let session = 0; session < 20; session++) {
        const sessionID = `background_${session}`
        for (let index = 0; index < 100; index++) {
          const id = `m_${session}_${index}`
          f.message(sessionID, id)
          f.part(sessionID, id, "x".repeat(4096))
        }
        f.emit({ type: "session.status", properties: { sessionID, status: { type: "busy" } } })
      }
      const request = {
        id: "permission",
        sessionID: "background_1",
        permission: "bash",
        patterns: [],
        metadata: {},
        always: [],
      }
      f.emit({ type: "permission.asked", properties: request })
      f.emit({ type: "question.asked", properties: { id: "question", sessionID: "background_1", questions: [] } })
      f.message("active", "active_m")
      f.part("active", "active_m", "visible")
      expect(Object.keys(f.state.message)).toEqual(["active"])
      expect(Object.keys(f.state.part)).toEqual(["active_m"])
      expect(Object.keys(f.state.session_status)).toHaveLength(20)
      expect(f.state.permission.background_1[0]).toEqual(request)
      expect(f.state.question.background_1).toHaveLength(1)
    } finally {
      f.stop()
    }
  })

  test("activation reloads authoritative transcript after leave and inactive updates", () => {
    const f = fixture()
    try {
      f.message("active", "m1")
      f.part("active", "m1", "before")
      f.activate("other")
      f.setStore(produce((draft) => applySessionLeavePrune(draft, "active")))
      f.part("active", "m1", "saved while inactive")
      expect(f.state.part.m1).toBeUndefined()
      f.activate("active")
      f.setStore(
        produce((draft) =>
          applySessionSyncSnapshot(draft, "active", {
            session: { id: "active" },
            todo: [],
            diff: [],
            messages: [
              {
                info: { id: "m1", sessionID: "active" },
                parts: [
                  { id: "part_m1", messageID: "m1", sessionID: "active", type: "text", text: "saved while inactive" },
                ],
              },
            ],
          }),
        ),
      )
      expect(f.state.part.m1[0].text).toBe("saved while inactive")
    } finally {
      f.stop()
    }
  })

  test("a queued delta from an earlier visit cannot mutate a reloaded same-session view", () => {
    vi.useFakeTimers()
    const f = fixture()
    try {
      f.message("active", "m1")
      f.part("active", "m1", "text")
      f.emit({
        type: "message.part.delta",
        properties: { sessionID: "active", messageID: "m1", partID: "part_m1", field: "text", delta: " stale" },
      })
      f.emit({
        type: "message.part.delta",
        properties: { sessionID: "active", messageID: "m1", partID: "part_m1", field: "text", delta: " also stale" },
      })
      f.activate("other")
      f.activate("active")
      vi.advanceTimersByTime(20)
      expect(f.state.part.m1[0].text).toBe("text")
      f.emit({
        type: "message.part.delta",
        properties: { sessionID: "active", messageID: "m1", partID: "part_m1", field: "text", delta: " fresh" },
      })
      vi.advanceTimersByTime(20)
      expect(f.state.part.m1[0].text).toBe("text fresh")
    } finally {
      f.stop()
      vi.useRealTimers()
    }
  })
})
