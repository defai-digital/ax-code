import { describe, expect, test } from "vitest"
import { createStore, produce } from "solid-js/store"
import {
  createStoreBackedSessionSyncController,
  type SessionSyncStoreState,
} from "../../../src/cli/cmd/tui/context/sync-session-sync"
import { applySessionLeavePrune } from "../../../src/cli/cmd/tui/context/sync-session-store"
import type { SyncedSessionRisk } from "../../../src/cli/cmd/tui/context/sync-session-risk"

type Session = { id: string; title: string }
type Todo = { id: string }
type Message = { id: string }
type Part = { id: string }
type Diff = { path: string }
type Risk = SyncedSessionRisk
type Goal = { objective: string }

function createState() {
  return createStore<SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk, Goal>>({
    session: [],
    todo: {},
    message: {},
    part: {},
    session_diff: {},
    session_risk: {},
    session_goal: {},
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
      Goal,
      SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk, Goal>
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
      fetchGoal: async (sessionID) => {
        calls.push(`goal:${sessionID}`)
        return { data: { objective: `goal:${sessionID}` } }
      },
    })

    await controller.sync("ses_1")

    expect(calls).toEqual(["session:ses_1", "messages:ses_1", "todo:ses_1", "diff:ses_1", "risk:ses_1", "goal:ses_1"])
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
      session_goal: { ses_1: { objective: "goal:ses_1" } },
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
      Goal,
      SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk, Goal>
    >({
      timeoutMs: 10_000,
      withTimeout: async (_label, promise) => promise,
      setStore,
      fetchSession: async () => ({ data: undefined }),
      fetchMessages: async () => ({ data: [] }),
      fetchTodo: async () => ({ data: [] }),
      fetchDiff: async () => ({ data: [] }),
      fetchRisk: async () => ({ data: undefined }),
      fetchGoal: async () => ({ data: undefined }),
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
      session_goal: {},
    })
  })

  test("leave prune + clear then re-enter sync reloads heavy state without force", async () => {
    // Integrated leave→re-enter path: mirrors session route onCleanup
    // (clear + applySessionLeavePrune) then runInitialSessionSync without force.
    const [store, setStore] = createState()
    let messageFetch = 0

    const controller = createStoreBackedSessionSyncController<
      Session,
      Todo,
      Message,
      Part,
      Diff,
      Risk,
      Goal,
      SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk, Goal>
    >({
      timeoutMs: 10_000,
      withTimeout: async (_label, promise) => promise,
      setStore,
      fetchSession: async (sessionID) => ({ data: { id: sessionID, title: "Session" } }),
      fetchMessages: async () => {
        messageFetch += 1
        return {
          data: [
            {
              info: { id: `msg_${messageFetch}` },
              parts: [{ id: `part_${messageFetch}` }],
            },
          ],
        }
      },
      fetchTodo: async () => ({ data: [{ id: `todo_${messageFetch || 1}` }] }),
      fetchDiff: async () => ({ data: [{ path: `file_${messageFetch || 1}.ts` }] }),
    })

    await controller.sync("ses_leave")
    expect(store.message.ses_leave).toEqual([{ id: "msg_1" }])
    expect(store.part.msg_1).toEqual([{ id: "part_1" }])
    expect(messageFetch).toBe(1)

    // Without clear, a second sync would no-op (fullSynced). Leave path clears.
    controller.clear("ses_leave")
    setStore(
      produce((draft) => {
        applySessionLeavePrune(draft, "ses_leave")
      }),
    )

    expect(store.session).toEqual([{ id: "ses_leave", title: "Session" }])
    expect(store.message.ses_leave).toBeUndefined()
    expect(store.part.msg_1).toBeUndefined()
    expect(store.todo.ses_leave).toBeUndefined()
    expect(store.session_diff.ses_leave).toBeUndefined()

    // Re-enter: same as runInitialSessionSync without force.
    await controller.sync("ses_leave")
    expect(messageFetch).toBe(2)
    expect(store.message.ses_leave).toEqual([{ id: "msg_2" }])
    expect(store.part.msg_2).toEqual([{ id: "part_2" }])
    expect(store.todo.ses_leave).toEqual([{ id: "todo_2" }])
    expect(store.session_diff.ses_leave).toEqual([{ path: "file_2.ts" }])
  })

  test("leave clear during in-flight sync drops late apply so re-enter loads cleanly", async () => {
    const [store, setStore] = createState()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let fetches = 0

    const controller = createStoreBackedSessionSyncController<
      Session,
      Todo,
      Message,
      Part,
      Diff,
      Risk,
      Goal,
      SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk, Goal>
    >({
      timeoutMs: 10_000,
      withTimeout: async (_label, promise) => promise,
      setStore,
      fetchSession: async (sessionID) => {
        fetches += 1
        if (fetches === 1) await gate
        return { data: { id: sessionID, title: fetches === 1 ? "stale" : "fresh" } }
      },
      fetchMessages: async () => ({
        data: [{ info: { id: `msg_${fetches}` }, parts: [{ id: `part_${fetches}` }] }],
      }),
      fetchTodo: async () => ({ data: [] }),
      fetchDiff: async () => ({ data: [] }),
    })

    const first = controller.sync("ses_race")
    // Leave while first fetch is still open.
    controller.clear("ses_race")
    setStore(
      produce((draft) => {
        applySessionLeavePrune(draft, "ses_race")
      }),
    )
    release?.()
    await first

    // Stale flight must not have re-filled heavy state after prune.
    expect(store.message.ses_race).toBeUndefined()
    expect(store.session.find((s) => s.id === "ses_race")).toBeUndefined()

    await controller.sync("ses_race")
    expect(fetches).toBe(2)
    expect(store.session).toEqual([{ id: "ses_race", title: "fresh" }])
    expect(store.message.ses_race).toEqual([{ id: "msg_2" }])
  })

  test("progressive enrichment does not clobber live stream part deltas after core paint", async () => {
    // Regression: store-backed applySnapshot must type/apply enrichment mode so
    // late full snapshots cannot overwrite parts that arrived while diff/risk/goal RPCs ran.
    const [store, setStore] = createState()
    let releaseDiff: (() => void) | undefined
    const diffGate = new Promise<void>((resolve) => {
      releaseDiff = resolve
    })

    const controller = createStoreBackedSessionSyncController<
      Session,
      Todo,
      Message,
      Part,
      Diff,
      Risk,
      Goal,
      SessionSyncStoreState<Session, Todo, Message, Part, Diff, Risk, Goal>
    >({
      timeoutMs: 10_000,
      withTimeout: async (_label, promise) => promise,
      setStore,
      fetchSession: async (sessionID) => ({ data: { id: sessionID, title: "Session" } }),
      fetchMessages: async () => ({
        data: [{ info: { id: "msg_1" }, parts: [{ id: "part_core" }] }],
      }),
      fetchTodo: async () => ({ data: [{ id: "todo_1" }] }),
      fetchDiff: async () => {
        await diffGate
        return { data: [{ path: "enriched.ts" }] }
      },
      fetchGoal: async () => ({ data: { objective: "ship" } }),
    })

    const flight = controller.sync("ses_prog")
    // Wait until core transcript is painted (before enrichment resolves).
    for (let i = 0; i < 50 && !store.message.ses_prog; i++) {
      await Promise.resolve()
    }
    expect(store.message.ses_prog).toEqual([{ id: "msg_1" }])
    expect(store.part.msg_1).toEqual([{ id: "part_core" }])
    expect(store.session_diff.ses_prog).toEqual([])

    // Live stream delta lands after core paint, before enrichment finishes.
    setStore(
      produce((draft) => {
        draft.part.msg_1 = [{ id: "part_core" }, { id: "part_live" }]
      }),
    )

    releaseDiff?.()
    await flight

    // Enrichment must patch sidebar only — live parts must survive.
    expect(store.part.msg_1).toEqual([{ id: "part_core" }, { id: "part_live" }])
    expect(store.message.ses_prog).toEqual([{ id: "msg_1" }])
    expect(store.session_diff.ses_prog).toEqual([{ path: "enriched.ts" }])
    expect(store.session_goal.ses_prog).toEqual({ objective: "ship" })
  })
})
