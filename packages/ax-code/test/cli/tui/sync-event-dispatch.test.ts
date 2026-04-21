import { describe, expect, test } from "bun:test"
import {
  applyMessageDeleteEvent,
  applyMessageUpdateEvent,
  applyPartDeleteEvent,
  applyPartDeltaEvent,
  applyPartUpdateEvent,
  applyRequestAskedEvent,
  applyRequestResolvedEvent,
  applySessionDeleteEvent,
  applySessionUpsertEvent,
} from "../../../src/cli/cmd/tui/context/sync-event-dispatch"

describe("tui sync event dispatch", () => {
  test("upserts session events into the sorted session list", () => {
    const sessions = [{ id: "ses_1" }, { id: "ses_3" }]

    applySessionUpsertEvent(sessions, { id: "ses_2" })

    expect(sessions).toEqual([{ id: "ses_1" }, { id: "ses_2" }, { id: "ses_3" }])
  })

  test("removes session-scoped data when a session delete event arrives", () => {
    const store: {
      session: Array<{ id: string }>
      permission: Record<string, Array<{ id: string }>>
      question: Record<string, Array<{ id: string }>>
      session_status: Record<string, string>
      session_risk: Record<string, { quality?: unknown }>
      session_diff: Record<string, Array<{ path: string }>>
      todo: Record<string, Array<{ id: string }>>
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string }>>
    } = {
      session: [{ id: "ses_1" }, { id: "ses_2" }],
      permission: { ses_1: [{ id: "perm_1" }] },
      question: { ses_1: [{ id: "question_1" }] },
      session_status: { ses_1: "working" },
      session_risk: {
        ses_1: {
          quality: {
            review: {
              workflow: "review",
              overallStatus: "warn",
              readyForBenchmark: false,
              resolvedLabeledItems: 0,
              totalItems: 1,
              nextAction: "Record outcome labels for the exported artifacts.",
            },
          },
        },
      },
      session_diff: { ses_1: [{ path: "file.ts" }] },
      todo: { ses_1: [{ id: "todo_1" }] },
      message: { ses_1: [{ id: "msg_1" }] },
      part: { msg_1: [{ id: "part_1" }] },
    }

    applySessionDeleteEvent(store, "ses_1")

    expect(store).toEqual({
      session: [{ id: "ses_2" }],
      permission: {},
      question: {},
      session_status: {},
      session_risk: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
    })
  })

  test("applies message update events with bounded cleanup", () => {
    const store: {
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string }>>
    } = {
      message: {
        ses_1: [{ id: "msg_1" }, { id: "msg_2" }],
      },
      part: {
        msg_1: [{ id: "part_1" }],
        msg_2: [{ id: "part_2" }],
      },
    }

    applyMessageUpdateEvent(store, "ses_1", { id: "msg_3" }, 2)

    expect(store).toEqual({
      message: {
        ses_1: [{ id: "msg_2" }, { id: "msg_3" }],
      },
      part: {
        msg_2: [{ id: "part_2" }],
      },
    })
  })

  test("applies message delete events with part cleanup", () => {
    const store: {
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string }>>
    } = {
      message: {
        ses_1: [{ id: "msg_1" }],
      },
      part: {
        msg_1: [{ id: "part_1" }],
      },
    }

    applyMessageDeleteEvent(store, "ses_1", "msg_1")

    expect(store).toEqual({
      message: {
        ses_1: [],
      },
      part: {},
    })
  })

  test("applies request asked and resolved events through the same dispatcher surface", () => {
    const store: Record<string, Array<{ id: string; sessionID: string }>> = {}

    applyRequestAskedEvent(store, { id: "req_2", sessionID: "ses_1" })
    applyRequestAskedEvent(store, { id: "req_1", sessionID: "ses_1" })
    applyRequestResolvedEvent(store, "ses_1", "req_2")

    expect(store).toEqual({
      ses_1: [{ id: "req_1", sessionID: "ses_1" }],
    })
  })

  test("applies part update, delta, and delete events through the dispatcher surface", () => {
    const store: Record<string, Array<{ id: string; type?: string; text?: string }>> = {}

    applyPartUpdateEvent(store, "msg_1", { id: "part_2", type: "text", text: "world" })
    applyPartUpdateEvent(store, "msg_1", { id: "part_1", type: "text", text: "hello" })
    expect(applyPartDeltaEvent(store, "msg_1", "part_1", "!")).toBe(true)
    expect(applyPartDeleteEvent(store, "msg_1", "part_2")).toEqual({ id: "part_2", type: "text", text: "world" })

    expect(store).toEqual({
      msg_1: [{ id: "part_1", type: "text", text: "hello!" }],
    })
  })
})
