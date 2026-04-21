import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { dispatchStoreBackedSyncEvent, type SyncEventStoreState } from "../../../src/cli/cmd/tui/context/sync-store-event"
import type { SyncedSessionRisk } from "../../../src/cli/cmd/tui/context/sync-session-risk"

type Session = { id: string }
type Todo = { id: string }
type Diff = { path: string }
type Status = string
type Message = { id: string; sessionID: string }
type Part = { id: string; messageID: string; type?: string; text?: string }

const reviewRisk: SyncedSessionRisk = {
  id: "risk_1",
  quality: {
    review: {
      workflow: "review",
      overallStatus: "pass",
      readyForBenchmark: true,
      labeledItems: 1,
      resolvedLabeledItems: 1,
      unresolvedLabeledItems: 0,
      missingLabels: 0,
      totalItems: 1,
      nextAction: null,
      gates: [],
    },
    debug: null,
    qa: null,
  },
}

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

describe("tui sync store event", () => {
  test("stores non-autonomous permission requests in the permission bucket", () => {
    const [store, setStore] = createTestStore()
    const replies: string[] = []

    const handled = dispatchStoreBackedSyncEvent({
      event: {
        type: "permission.asked",
        properties: {
          id: "perm_1",
          sessionID: "ses_1",
          permission: "shell",
          patterns: [],
          metadata: {},
          always: [],
        },
      },
      autonomous: false,
      setStore,
      clearSessionSyncState: () => undefined,
      replyPermission(payload) {
        replies.push(JSON.stringify(payload))
      },
      replyQuestion: () => undefined,
      syncMcpStatus: () => undefined,
      syncLspStatus: () => undefined,
      syncDebugEngine: () => undefined,
      bootstrap: () => undefined,
      onWarn: () => undefined,
      maxSessionMessages: 100,
    })

    expect(handled).toBe(true)
    expect(replies).toEqual([])
    expect(store.permission).toEqual({
      ses_1: [
        {
          id: "perm_1",
          sessionID: "ses_1",
          permission: "shell",
          patterns: [],
          metadata: {},
          always: [],
        },
      ],
    })
  })

  test("routes autonomous permission requests to reply callbacks without mutating the permission bucket", async () => {
    const [store, setStore] = createTestStore()
    const replies: unknown[] = []

    const handled = dispatchStoreBackedSyncEvent({
      event: {
        type: "permission.asked",
        properties: {
          id: "perm_1",
          sessionID: "ses_1",
          permission: "shell",
          patterns: [],
          metadata: {},
          always: [],
        },
      },
      autonomous: true,
      setStore,
      clearSessionSyncState: () => undefined,
      replyPermission(payload) {
        replies.push(payload)
      },
      replyQuestion: () => undefined,
      syncMcpStatus: () => undefined,
      syncLspStatus: () => undefined,
      syncDebugEngine: () => undefined,
      bootstrap: () => undefined,
      onWarn: () => undefined,
      maxSessionMessages: 100,
    })

    await Promise.resolve()

    expect(handled).toBe(true)
    expect(replies).toHaveLength(1)
    expect(store.permission).toEqual({})
  })

  test("clears session sync state and removes session-scoped data on session deletion", () => {
    const [store, setStore] = createTestStore()
    const cleared: string[] = []

    setStore({
      permission: { ses_1: [{ id: "perm_1", sessionID: "ses_1", permission: "shell", patterns: [], metadata: {}, always: [] }] },
      question: {},
      todo: { ses_1: [{ id: "todo_1" }] },
      session_diff: { ses_1: [{ path: "file.ts" }] },
      session_status: { ses_1: "working" },
      session_risk: { ses_1: reviewRisk },
      session: [{ id: "ses_1" }],
      message: { ses_1: [{ id: "msg_1", sessionID: "ses_1" }] },
      part: { msg_1: [{ id: "part_1", messageID: "msg_1" }] },
      vcs: undefined,
    })

    const handled = dispatchStoreBackedSyncEvent({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "ses_1" },
        },
      },
      autonomous: false,
      setStore,
      clearSessionSyncState(sessionID) {
        cleared.push(sessionID)
      },
      replyPermission: () => undefined,
      replyQuestion: () => undefined,
      syncMcpStatus: () => undefined,
      syncLspStatus: () => undefined,
      syncDebugEngine: () => undefined,
      bootstrap: () => undefined,
      onWarn: () => undefined,
      maxSessionMessages: 100,
    })

    expect(handled).toBe(true)
    expect(cleared).toEqual(["ses_1"])
    expect(store).toEqual({
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
  })

  test("applies runtime branch updates through the same store-backed dispatcher", () => {
    const [store, setStore] = createTestStore()

    const handled = dispatchStoreBackedSyncEvent({
      event: {
        type: "vcs.branch.updated",
        properties: { branch: "feature/test" },
      },
      autonomous: false,
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
    })

    expect(handled).toBe(true)
    expect(store.vcs).toEqual({ branch: "feature/test" })
  })
})
