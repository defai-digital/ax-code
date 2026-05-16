import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import {
  createStoreBackedSessionSyncController,
  type SessionSyncStoreState,
} from "../../../src/cli/cmd/tui/context/sync-session-sync"
import type { SyncedSessionRisk } from "../../../src/cli/cmd/tui/context/sync-session-risk"

type Session = { id: string; title: string }
type Todo = { id: string }
type Message = { id: string }
type Part = { id: string }
type Diff = { path: string }
type Risk = SyncedSessionRisk

function createState() {
  return createStore<SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk>>({
    session: [],
    todo: {},
    message: {},
    part: {},
    session_diff: {},
    session_risk: {},
  })
}

describe("tui sync session sync", () => {
  test("fetches and applies a full session snapshot through the store-backed controller", async () => {
    const [store, setStore] = createState()
    const calls: string[] = []

    const controller = createStoreBackedSessionSyncController<
      Session,
      Todo,
      Message,
      Part,
      Diff,
      Risk,
      SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk>
    >({
      timeoutMs: 10_000,
      withTimeout: async (_label, promise) => promise,
      setStore,
      fetchSession: async (sessionID) => {
        calls.push(`session:${sessionID}`)
        return { data: { id: sessionID, title: "Session" } }
      },
      fetchMessages: async (sessionID) => {
        calls.push(`messages:${sessionID}`)
        return { data: [{ info: { id: "msg_1" }, parts: [{ id: "part_1" }] }] }
      },
      fetchTodo: async (sessionID) => {
        calls.push(`todo:${sessionID}`)
        return { data: [{ id: "todo_1" }] }
      },
      fetchDiff: async (sessionID) => {
        calls.push(`diff:${sessionID}`)
        return { data: [{ path: "file.ts" }] }
      },
      fetchRisk: async (sessionID) => {
        calls.push(`risk:${sessionID}`)
        return {
          data: {
            id: `risk:${sessionID}`,
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
          },
        }
      },
    })

    await controller.sync("ses_1")

    expect(calls).toEqual(["session:ses_1", "messages:ses_1", "todo:ses_1", "diff:ses_1", "risk:ses_1"])
    expect(store).toEqual({
      session: [{ id: "ses_1", title: "Session" }],
      todo: { ses_1: [{ id: "todo_1" }] },
      message: { ses_1: [{ id: "msg_1" }] },
      part: { msg_1: [{ id: "part_1" }] },
      session_diff: { ses_1: [{ path: "file.ts" }] },
      session_risk: {
        ses_1: {
          id: "risk:ses_1",
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
        },
      },
    })
  })

  test("warns on missing snapshots and leaves the store unchanged", async () => {
    const [store, setStore] = createState()
    const warnings: string[] = []

    const controller = createStoreBackedSessionSyncController<
      Session,
      Todo,
      Message,
      Part,
      Diff,
      Risk,
      SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk>
    >({
      timeoutMs: 10_000,
      withTimeout: async (_label, promise) => promise,
      setStore,
      fetchSession: async () => ({ data: undefined }),
      fetchMessages: async () => ({ data: [] }),
      fetchTodo: async () => ({ data: [] }),
      fetchDiff: async () => ({ data: [] }),
      fetchRisk: async () => ({ data: undefined }),
      onMissingSnapshot(sessionID) {
        warnings.push(sessionID)
      },
    })

    await controller.sync("ses_1")

    expect(warnings).toEqual(["ses_1"])
    expect(store).toEqual({
      session: [],
      todo: {},
      message: {},
      part: {},
      session_diff: {},
      session_risk: {},
    })
  })
})
