import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { SyncEventStoreState } from "../../../src/cli/cmd/tui/context/sync-store-event"
import { subscribeStoreBackedSyncEvents } from "../../../src/cli/cmd/tui/context/sync-subscription"

type Session = { id: string }
type Todo = { id: string }
type Diff = { path: string }
type Status = string
type Message = { id: string; sessionID: string }
type Part = { id: string; messageID: string }

function createTestStore() {
  return createStore<SyncEventStoreState<Session, Todo, Diff, Status, Message, Part>>({
    permission: {},
    question: {},
    todo: {},
    session_diff: {},
    session_status: {},
    session_risk: {},
    session: [],
    message: {},
    part: {},
    vcs: undefined,
  })
}

describe("tui sync subscription", () => {
  test("subscribes through the shared store-backed dispatcher with the latest autonomous state", () => {
    const [_store, setStore] = createTestStore()
    const dispatched: Array<{ autonomous: boolean; type: string }> = []
    let listener: ((event: { details: unknown }) => void) | undefined
    const unsubscribe = () => "unsubscribed"
    let autonomous = false

    const result = subscribeStoreBackedSyncEvents<
      Session,
      Todo,
      Diff,
      Status,
      Message,
      Part,
      SyncEventStoreState<Session, Todo, Diff, Status, Message, Part>
    >({
      listen(handler) {
        listener = handler
        return unsubscribe
      },
      getAutonomous: () => autonomous,
      setStore,
      clearSessionSyncState: () => undefined,
      replyPermission: () => undefined,
      replyQuestion: () => undefined,
      syncMcpStatus: () => undefined,
      syncLspStatus: () => undefined,
      syncDebugEngine: () => undefined,
      bootstrap: () => undefined,
      onWarn: () => undefined,
      maxSessionMessages: 100,
      onHandlerError: () => undefined,
      dispatch(input) {
        dispatched.push({ autonomous: input.autonomous, type: input.event.type })
        return true
      },
    })

    listener?.({ details: { type: "session.updated", properties: { info: { id: "ses_1" } } } })
    autonomous = true
    listener?.({ details: { type: "permission.asked", properties: { id: "perm_1", sessionID: "ses_1", permission: "shell", patterns: [], metadata: {}, always: [] } } })

    expect(result).toBe(unsubscribe)
    expect(dispatched).toEqual([
      { autonomous: false, type: "session.updated" },
      { autonomous: true, type: "permission.asked" },
    ])
  })

  test("reports handler errors with the event type and stringified error", () => {
    const [_store, setStore] = createTestStore()
    const errors: Array<{ type: string | undefined; error: string }> = []
    let listener: ((event: { details: unknown }) => void) | undefined

    subscribeStoreBackedSyncEvents<
      Session,
      Todo,
      Diff,
      Status,
      Message,
      Part,
      SyncEventStoreState<Session, Todo, Diff, Status, Message, Part>
    >({
      listen(handler) {
        listener = handler
        return () => undefined
      },
      getAutonomous: () => false,
      setStore,
      clearSessionSyncState: () => undefined,
      replyPermission: () => undefined,
      replyQuestion: () => undefined,
      syncMcpStatus: () => undefined,
      syncLspStatus: () => undefined,
      syncDebugEngine: () => undefined,
      bootstrap: () => undefined,
      onWarn: () => undefined,
      maxSessionMessages: 100,
      onHandlerError(error) {
        errors.push(error)
      },
      dispatch() {
        throw new Error("subscription dispatch failed")
      },
    })

    listener?.({ details: { type: "session.deleted", properties: { info: { id: "ses_1" } } } })

    expect(errors).toEqual([
      { type: "session.deleted", error: "subscription dispatch failed" },
    ])
  })
})
