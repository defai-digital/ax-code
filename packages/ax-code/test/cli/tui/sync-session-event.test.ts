import { describe, expect, test } from "bun:test"
import { handleSessionSyncEvent } from "../../../src/cli/cmd/tui/context/sync-session-event"

describe("tui sync session event", () => {
  test("routes todo, diff, and status events to the matching session-scoped handlers", () => {
    const calls: string[] = []

    handleSessionSyncEvent(
      { type: "todo.updated", properties: { sessionID: "ses_1", todos: [{ id: "todo_1" }] } },
      {
        setTodo(sessionID, todos) {
          calls.push(`todo:${sessionID}:${todos.length}`)
        },
        setSessionDiff: () => undefined,
        setSessionStatus: () => undefined,
        deleteSession: () => undefined,
        upsertSession: () => undefined,
        clearSessionSyncState: () => undefined,
      },
    )

    handleSessionSyncEvent(
      { type: "session.diff", properties: { sessionID: "ses_1", diff: [{ path: "file.ts" }] } },
      {
        setTodo: () => undefined,
        setSessionDiff(sessionID, diff) {
          calls.push(`diff:${sessionID}:${diff.length}`)
        },
        setSessionStatus: () => undefined,
        deleteSession: () => undefined,
        upsertSession: () => undefined,
        clearSessionSyncState: () => undefined,
      },
    )

    handleSessionSyncEvent(
      { type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } },
      {
        setTodo: () => undefined,
        setSessionDiff: () => undefined,
        setSessionStatus(sessionID, status) {
          calls.push(`status:${sessionID}:${status.type}`)
        },
        deleteSession: () => undefined,
        upsertSession: () => undefined,
        clearSessionSyncState: () => undefined,
      },
    )

    expect(calls).toEqual(["todo:ses_1:1", "diff:ses_1:1", "status:ses_1:busy"])
  })

  test("clears sync state before deleting a session", () => {
    const calls: string[] = []

    const handled = handleSessionSyncEvent(
      { type: "session.deleted", properties: { info: { id: "ses_2" } } },
      {
        setTodo: () => undefined,
        setSessionDiff: () => undefined,
        setSessionStatus: () => undefined,
        deleteSession(sessionID) {
          calls.push(`delete:${sessionID}`)
        },
        upsertSession: () => undefined,
        clearSessionSyncState(sessionID) {
          calls.push(`clear:${sessionID}`)
        },
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(["clear:ses_2", "delete:ses_2"])
  })

  test("routes created and updated session events through the same upsert handler", () => {
    const sessions: string[] = []

    handleSessionSyncEvent(
      { type: "session.created", properties: { info: { id: "ses_3" } } },
      {
        setTodo: () => undefined,
        setSessionDiff: () => undefined,
        setSessionStatus: () => undefined,
        deleteSession: () => undefined,
        upsertSession(session) {
          sessions.push(session.id)
        },
        clearSessionSyncState: () => undefined,
      },
    )

    handleSessionSyncEvent(
      { type: "session.updated", properties: { info: { id: "ses_4" } } },
      {
        setTodo: () => undefined,
        setSessionDiff: () => undefined,
        setSessionStatus: () => undefined,
        deleteSession: () => undefined,
        upsertSession(session) {
          sessions.push(session.id)
        },
        clearSessionSyncState: () => undefined,
      },
    )

    expect(sessions).toEqual(["ses_3", "ses_4"])
  })
})
