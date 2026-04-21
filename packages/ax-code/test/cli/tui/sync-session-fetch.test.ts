import { describe, expect, test } from "bun:test"
import { fetchSessionSyncSnapshot } from "../../../src/cli/cmd/tui/context/sync-session-fetch"

describe("tui sync session fetch", () => {
  test("loads a full session snapshot through the shared timeout wrapper", async () => {
    const calls: Array<{ label: string; timeoutMs: number }> = []

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
    })

    expect(calls).toEqual([
      { label: "tui session sync ses_1 session.get", timeoutMs: 2500 },
      { label: "tui session sync ses_1 session.messages", timeoutMs: 2500 },
      { label: "tui session sync ses_1 session.todo", timeoutMs: 2500 },
      { label: "tui session sync ses_1 session.diff", timeoutMs: 2500 },
      { label: "tui session sync ses_1 session.risk", timeoutMs: 2500 },
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
    })
  })

  test("soft-fails optional risk enrichment without breaking the session snapshot", async () => {
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
    })

    expect(snapshot).toEqual({
      session: { id: "ses_3", title: "Session" },
      todo: [],
      messages: [],
      diff: [],
      risk: undefined,
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
    })

    expect(snapshot).toBeUndefined()
  })
})
