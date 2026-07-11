import { describe, expect, test } from "vitest"
import { fetchSessionSyncSnapshot } from "../../../src/cli/cmd/tui/context/sync-session-fetch"

describe("tui sync session fetch", () => {
  test("loads a full session snapshot through the shared timeout wrapper", async () => {
    const calls: Array<{ label: string; timeoutMs: number }> = []
    const coreReady: unknown[] = []

    const snapshot = await fetchSessionSyncSnapshot({
      sessionID: "ses_1",
      timeoutMs: 2500,
      withTimeout(label, promise, timeoutMs) {
        calls.push({ label, timeoutMs })
        return promise
      },
      fetchSession: async () => ({ data: { id: "ses_1", title: "Session" } }),
      fetchMessages: async () => ({
        data: [{ info: { id: "msg_1" }, parts: [{ id: "part_1", text: "hello" }] }],
      }),
      fetchTodo: async () => ({ data: [{ id: "todo_1" }] }),
      fetchDiff: async () => ({ data: [{ path: "file.ts" }] }),
      fetchRisk: async () => ({
        data: {
          id: "ses_1",
          quality: {
            review: {
              workflow: "review",
              overallStatus: "pass",
              readyForBenchmark: true,
              resolvedLabeledItems: 2,
              totalItems: 2,
              nextAction: null,
            },
            debug: null,
          },
        },
      }),
      fetchGoal: async () => ({
        data: {
          sessionID: "ses_1",
          objective: "finish goals",
          status: "active",
          tokensUsed: 25,
          remainingTokens: 75,
          tokenBudget: 100,
          timeUsedSeconds: 3,
          time: { created: 1, updated: 2 },
        },
      }),
      onCoreReady(core) {
        coreReady.push(core)
      },
    })

    // Core transcript fields are requested before enrichment.
    expect(calls.slice(0, 3)).toEqual([
      { label: "tui session sync ses_1 session.get", timeoutMs: 2500 },
      { label: "tui session sync ses_1 session.messages", timeoutMs: 2500 },
      { label: "tui session sync ses_1 session.todo", timeoutMs: 2500 },
    ])
    expect(calls.slice(3)).toEqual([
      { label: "tui session sync ses_1 session.diff", timeoutMs: 2500 },
      { label: "tui session sync ses_1 session.risk", timeoutMs: 2500 },
      { label: "tui session sync ses_1 session.goal", timeoutMs: 2500 },
    ])
    expect(coreReady).toEqual([
      {
        session: { id: "ses_1", title: "Session" },
        todo: [{ id: "todo_1" }],
        messages: [{ info: { id: "msg_1" }, parts: [{ id: "part_1", text: "hello" }] }],
        diff: [],
        risk: undefined,
        goal: undefined,
      },
    ])
    expect(snapshot).toEqual({
      session: { id: "ses_1", title: "Session" },
      todo: [{ id: "todo_1" }],
      messages: [{ info: { id: "msg_1" }, parts: [{ id: "part_1", text: "hello" }] }],
      diff: [{ path: "file.ts" }],
      risk: {
        id: "ses_1",
        quality: {
          review: {
            workflow: "review",
            overallStatus: "pass",
            readyForBenchmark: true,
            resolvedLabeledItems: 2,
            totalItems: 2,
            nextAction: null,
          },
          debug: null,
        },
      },
      goal: {
        sessionID: "ses_1",
        objective: "finish goals",
        status: "active",
        tokensUsed: 25,
        remainingTokens: 75,
        tokenBudget: 100,
        timeUsedSeconds: 3,
        time: { created: 1, updated: 2 },
      },
    })
  })

  test("surfaces core snapshot before slow enrichment resolves", async () => {
    let releaseDiff: (() => void) | undefined
    const diffGate = new Promise<void>((resolve) => {
      releaseDiff = resolve
    })
    let resolveCore: (() => void) | undefined
    const coreSeen = new Promise<void>((resolve) => {
      resolveCore = resolve
    })
    const coreReady: string[] = []

    const pending = fetchSessionSyncSnapshot({
      sessionID: "ses_slow",
      timeoutMs: 1000,
      withTimeout: (_label, promise) => promise,
      fetchSession: async () => ({ data: { id: "ses_slow", title: "Slow" } }),
      fetchMessages: async () => ({ data: [] }),
      fetchTodo: async () => ({ data: [] }),
      fetchDiff: async () => {
        await diffGate
        return { data: [{ path: "late.ts" }] }
      },
      onCoreReady(core) {
        coreReady.push(core.session.id)
        resolveCore?.()
      },
    })

    await coreSeen
    expect(coreReady).toEqual(["ses_slow"])
    releaseDiff?.()
    const snapshot = await pending
    expect(snapshot?.diff).toEqual([{ path: "late.ts" }])
  })

  test("soft-fails optional enrichment without breaking the session snapshot", async () => {
    const snapshot = await fetchSessionSyncSnapshot({
      sessionID: "ses_3",
      timeoutMs: 1000,
      withTimeout: (_label, promise) => promise,
      fetchSession: async () => ({ data: { id: "ses_3", title: "Session" } }),
      fetchMessages: async () => ({ data: [] }),
      fetchTodo: async () => ({ data: [] }),
      fetchDiff: async () => ({ data: [] }),
      fetchRisk: async () => {
        throw new Error("risk unavailable")
      },
      fetchGoal: async () => {
        throw new Error("goal unavailable")
      },
    })

    expect(snapshot).toEqual({
      session: { id: "ses_3", title: "Session" },
      todo: [],
      messages: [],
      diff: [],
      risk: undefined,
      goal: undefined,
    })
  })

  test("returns no snapshot when the session payload is missing", async () => {
    const snapshot = await fetchSessionSyncSnapshot({
      sessionID: "ses_2",
      timeoutMs: 1000,
      withTimeout: (_label, promise) => promise,
      fetchSession: async () => ({ data: undefined }),
      fetchMessages: async () => ({ data: undefined }),
      fetchTodo: async () => ({ data: undefined }),
      fetchDiff: async () => ({ data: undefined }),
      fetchRisk: async () => ({ data: undefined }),
      fetchGoal: async () => ({ data: undefined }),
    })

    expect(snapshot).toBeUndefined()
  })
})
