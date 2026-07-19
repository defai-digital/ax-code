import { describe, expect, test } from "vitest"
import {
  applySessionDeleteCleanup,
  applySessionLeavePrune,
  applySessionSyncEnrichment,
  applySessionSyncSnapshot,
  createSessionSyncSnapshot,
  pruneOrphanSessionRecords,
} from "../../../src/cli/cmd/tui/context/sync-session-store"

describe("tui sync session store", () => {
  test("does not build a session sync snapshot when session data is missing", () => {
    expect(
      createSessionSyncSnapshot({
        session: undefined,
        todo: [{ id: "todo_1" }],
        messages: [{ info: { id: "msg_1" }, parts: [{ id: "part_1" }] }],
        diff: [{ path: "file.ts" }],
        risk: undefined,
        goal: undefined,
      }),
    ).toBeUndefined()
  })

  test("builds a session sync snapshot with empty defaults for optional collections", () => {
    expect(
      createSessionSyncSnapshot({
        session: { id: "ses_1", title: "current" },
        todo: undefined,
        messages: undefined,
        diff: undefined,
        risk: undefined,
        goal: undefined,
      }),
    ).toEqual({
      session: { id: "ses_1", title: "current" },
      todo: [],
      messages: [],
      diff: [],
      risk: undefined,
      goal: undefined,
    })
  })

  test("drops malformed message payloads that would crash snapshot application", () => {
    expect(
      createSessionSyncSnapshot({
        session: { id: "ses_1", title: "current" },
        todo: { not: "an array" } as any,
        messages: [{ info: { id: "msg_1" }, parts: [] }, null, { parts: [] }, { info: null, parts: [] }] as any,
        diff: "nope" as any,
        risk: undefined,
        goal: undefined,
      }),
    ).toEqual({
      session: { id: "ses_1", title: "current" },
      todo: [],
      messages: [{ info: { id: "msg_1" }, parts: [] }],
      diff: [],
      risk: undefined,
      goal: undefined,
    })
  })

  test("coerces malformed session snapshot collections before hydration", () => {
    expect(
      createSessionSyncSnapshot({
        session: { id: "ses_1", title: "current" },
        todo: { id: "not-array" },
        messages: [
          null,
          {},
          { info: {} },
          { info: { id: 42 }, parts: [] },
          { info: { id: "msg_1" }, parts: "not-array" },
          { info: { id: "msg_2" }, parts: [{ id: "part_1" }] },
        ],
        diff: { path: "not-array" },
        risk: undefined,
        goal: undefined,
      } as any),
    ).toEqual({
      session: { id: "ses_1", title: "current" },
      todo: [],
      messages: [
        { info: { id: "msg_1" }, parts: [] },
        { info: { id: "msg_2" }, parts: [{ id: "part_1" }] },
      ],
      diff: [],
      risk: undefined,
      goal: undefined,
    })
  })

  test("enrichment apply patches sidebar fields without touching messages/parts", () => {
    const store = {
      session: [{ id: "ses_1", title: "current" }],
      todo: { ses_1: [{ id: "todo_1" }] },
      message: { ses_1: [{ id: "msg_1" }] },
      part: { msg_1: [{ id: "part_1", text: "live delta" }] },
      session_diff: { ses_1: [] as Array<{ path: string }> },
      session_risk: {} as Record<string, { quality?: unknown }>,
      session_goal: {} as Record<string, { objective: string } | null>,
    }

    applySessionSyncEnrichment(store, "ses_1", {
      diff: [{ path: "enriched.ts" }],
      risk: { quality: { review: null, debug: null } },
      goal: { objective: "ship it" },
    })

    expect(store.part.msg_1).toEqual([{ id: "part_1", text: "live delta" }])
    expect(store.message.ses_1).toEqual([{ id: "msg_1" }])
    expect(store.session_diff.ses_1).toEqual([{ path: "enriched.ts" }])
    expect(store.session_goal.ses_1).toEqual({ objective: "ship it" })
  })

  test("hydrates session state and removes stale part buckets on full sync", () => {
    const store: {
      session: Array<{ id: string; title: string }>
      todo: Record<string, Array<{ id: string }>>
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string; text: string }>>
      session_diff: Record<string, Array<{ path: string }>>
      session_risk: Record<string, { quality?: unknown }>
      session_goal: Record<string, { objective: string } | null>
    } = {
      session: [{ id: "ses_1", title: "old" }],
      todo: { ses_1: [{ id: "todo_old" }] },
      message: {
        ses_1: [{ id: "msg_old" }, { id: "msg_keep" }],
      },
      part: {
        msg_old: [{ id: "part_old", text: "remove" }],
        msg_keep: [{ id: "part_keep_old", text: "replace" }],
        msg_new: [{ id: "part_new_old", text: "replace" }],
      },
      session_diff: { ses_1: [{ path: "old.ts" }] },
      session_risk: { ses_1: { quality: { review: null, debug: null } } },
      session_goal: { ses_1: { objective: "old" } },
    }

    applySessionSyncSnapshot(store, "ses_1", {
      session: { id: "ses_1", title: "new" },
      todo: [{ id: "todo_new" }],
      messages: [
        {
          info: { id: "msg_keep" },
          parts: [{ id: "part_keep_new", text: "fresh" }],
        },
        {
          info: { id: "msg_new" },
          parts: [{ id: "part_new", text: "new" }],
        },
      ],
      diff: [{ path: "new.ts" }],
      risk: {
        quality: {
          review: {
            workflow: "review",
            overallStatus: "pass",
            readyForBenchmark: true,
            resolvedLabeledItems: 1,
            totalItems: 1,
            nextAction: null,
          },
          debug: null,
        },
      },
      goal: { objective: "new" },
    })

    expect(store).toEqual({
      session: [{ id: "ses_1", title: "new" }],
      todo: { ses_1: [{ id: "todo_new" }] },
      message: {
        ses_1: [{ id: "msg_keep" }, { id: "msg_new" }],
      },
      part: {
        msg_keep: [{ id: "part_keep_new", text: "fresh" }],
        msg_new: [{ id: "part_new", text: "new" }],
      },
      session_diff: { ses_1: [{ path: "new.ts" }] },
      session_risk: {
        ses_1: {
          quality: {
            review: {
              workflow: "review",
              overallStatus: "pass",
              readyForBenchmark: true,
              resolvedLabeledItems: 1,
              totalItems: 1,
              nextAction: null,
            },
            debug: null,
          },
        },
      },
      session_goal: { ses_1: { objective: "new" } },
    })
  })

  test("preserves live tail messages that arrived after a snapshot fetch started", () => {
    const store: {
      session: Array<{ id: string; title: string }>
      todo: Record<string, Array<{ id: string }>>
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string; text: string }>>
      session_diff: Record<string, Array<{ path: string }>>
      session_risk: Record<string, { quality?: unknown }>
      session_goal: Record<string, { objective: string } | null>
    } = {
      session: [{ id: "ses_1", title: "old" }],
      todo: { ses_1: [] },
      message: {
        ses_1: [{ id: "msg_1" }, { id: "msg_2" }],
      },
      part: {
        msg_1: [{ id: "part_1_old", text: "replace" }],
        msg_2: [{ id: "part_2_live", text: "keep" }],
      },
      session_diff: { ses_1: [] },
      session_risk: {},
      session_goal: {},
    }

    applySessionSyncSnapshot(store, "ses_1", {
      session: { id: "ses_1", title: "new" },
      todo: [],
      messages: [
        {
          info: { id: "msg_1" },
          parts: [{ id: "part_1_new", text: "fresh" }],
        },
      ],
      diff: [],
      risk: undefined,
      goal: undefined,
    })

    expect(store.message.ses_1).toEqual([{ id: "msg_1" }, { id: "msg_2" }])
    expect(store.part).toEqual({
      msg_1: [{ id: "part_1_new", text: "fresh" }],
      msg_2: [{ id: "part_2_live", text: "keep" }],
    })
  })

  test("preserves live messages when a first snapshot has no overlap with the store", () => {
    const store: {
      session: Array<{ id: string; title: string }>
      todo: Record<string, Array<{ id: string }>>
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string; text: string }>>
      session_diff: Record<string, Array<{ path: string }>>
      session_risk: Record<string, { quality?: unknown }>
      session_goal: Record<string, { objective: string } | null>
    } = {
      session: [{ id: "ses_1", title: "old" }],
      todo: { ses_1: [] },
      message: {
        ses_1: [{ id: "msg_live" }],
      },
      part: {
        msg_live: [{ id: "part_live", text: "keep" }],
      },
      session_diff: { ses_1: [] },
      session_risk: {},
      session_goal: {},
    }

    applySessionSyncSnapshot(store, "ses_1", {
      session: { id: "ses_1", title: "new" },
      todo: [],
      messages: [
        {
          info: { id: "msg_snapshot" },
          parts: [{ id: "part_snapshot", text: "fresh" }],
        },
      ],
      diff: [],
      risk: undefined,
      goal: undefined,
    })

    expect(store.message.ses_1).toEqual([{ id: "msg_live" }, { id: "msg_snapshot" }])
    expect(store.part).toEqual({
      msg_live: [{ id: "part_live", text: "keep" }],
      msg_snapshot: [{ id: "part_snapshot", text: "fresh" }],
    })
  })

  test("removes all session-scoped data and message parts when a session is deleted", () => {
    const store: {
      session: Array<{ id: string }>
      permission: Record<string, Array<{ id: string }>>
      question: Record<string, Array<{ id: string }>>
      session_status: Record<string, string>
      session_risk: Record<string, { quality?: unknown }>
      session_goal: Record<string, { objective: string } | null>
      session_diff: Record<string, Array<{ path: string }>>
      todo: Record<string, Array<{ id: string }>>
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string }>>
    } = {
      session: [{ id: "ses_1" }, { id: "ses_2" }],
      permission: {
        ses_1: [{ id: "perm_1" }],
        ses_2: [{ id: "perm_2" }],
      },
      question: {
        ses_1: [{ id: "question_1" }],
        ses_2: [{ id: "question_2" }],
      },
      session_status: {
        ses_1: "working",
        ses_2: "idle",
      },
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
        ses_2: {
          quality: {
            review: {
              workflow: "review",
              overallStatus: "pass",
              readyForBenchmark: true,
              resolvedLabeledItems: 1,
              totalItems: 1,
              nextAction: null,
            },
          },
        },
      },
      session_goal: {
        ses_1: { objective: "delete" },
        ses_2: { objective: "keep" },
      },
      session_diff: {
        ses_1: [{ path: "delete.ts" }],
        ses_2: [{ path: "keep.ts" }],
      },
      todo: {
        ses_1: [{ id: "todo_1" }],
        ses_2: [{ id: "todo_2" }],
      },
      message: {
        ses_1: [{ id: "msg_1" }, { id: "msg_2" }],
        ses_2: [{ id: "msg_3" }],
      },
      part: {
        msg_1: [{ id: "part_1" }],
        msg_2: [{ id: "part_2" }],
        msg_3: [{ id: "part_3" }],
      },
    }

    applySessionDeleteCleanup(store, "ses_1")

    expect(store).toEqual({
      session: [{ id: "ses_2" }],
      permission: {
        ses_2: [{ id: "perm_2" }],
      },
      question: {
        ses_2: [{ id: "question_2" }],
      },
      session_status: {
        ses_2: "idle",
      },
      session_risk: {
        ses_2: {
          quality: {
            review: {
              workflow: "review",
              overallStatus: "pass",
              readyForBenchmark: true,
              resolvedLabeledItems: 1,
              totalItems: 1,
              nextAction: null,
            },
          },
        },
      },
      session_goal: {
        ses_2: { objective: "keep" },
      },
      session_diff: {
        ses_2: [{ path: "keep.ts" }],
      },
      todo: {
        ses_2: [{ id: "todo_2" }],
      },
      message: {
        ses_2: [{ id: "msg_3" }],
      },
      part: {
        msg_3: [{ id: "part_3" }],
      },
    })
  })

  test("leave prune drops heavy transcript state but keeps list row and interactive maps", () => {
    const store = {
      session: [{ id: "ses_1" }, { id: "ses_2" }],
      permission: {
        ses_1: [{ id: "perm_1" }],
        ses_2: [{ id: "perm_2" }],
      },
      question: {
        ses_1: [{ id: "question_1" }],
      },
      session_status: {
        ses_1: "busy",
        ses_2: "idle",
      },
      session_risk: {
        ses_1: { score: 1 },
        ses_2: { score: 2 },
      },
      session_goal: {
        ses_1: { objective: "leave" },
        ses_2: { objective: "keep" },
      },
      session_diff: {
        ses_1: [{ path: "leave.ts" }],
        ses_2: [{ path: "keep.ts" }],
      },
      todo: {
        ses_1: [{ id: "todo_1" }],
        ses_2: [{ id: "todo_2" }],
      },
      message: {
        ses_1: [{ id: "msg_1" }, { id: "msg_2" }],
        ses_2: [{ id: "msg_3" }],
      },
      part: {
        msg_1: [{ id: "part_1" }],
        msg_2: [{ id: "part_2" }],
        msg_3: [{ id: "part_3" }],
      },
    }

    applySessionLeavePrune(store, "ses_1")

    expect(store.session).toEqual([{ id: "ses_1" }, { id: "ses_2" }])
    expect(store.permission.ses_1).toEqual([{ id: "perm_1" }])
    expect(store.question.ses_1).toEqual([{ id: "question_1" }])
    expect(store.session_status.ses_1).toBe("busy")
    expect(store.message.ses_1).toBeUndefined()
    expect(store.todo.ses_1).toBeUndefined()
    expect(store.session_diff.ses_1).toBeUndefined()
    expect(store.session_risk.ses_1).toBeUndefined()
    expect(store.session_goal.ses_1).toBeUndefined()
    expect(store.part.msg_1).toBeUndefined()
    expect(store.part.msg_2).toBeUndefined()
    expect(store.message.ses_2).toEqual([{ id: "msg_3" }])
    expect(store.part.msg_3).toEqual([{ id: "part_3" }])
  })

  test("leave prune is a no-op for sessions with no heavy projection", () => {
    const store = {
      session_risk: {},
      session_goal: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
    }

    expect(() => applySessionLeavePrune(store, "ses_missing")).not.toThrow()
    expect(store).toEqual({
      session_risk: {},
      session_goal: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
    })
  })

  test("prunes session-keyed projection for sessions no longer in the list", () => {
    const store = {
      session: [{ id: "ses_keep" }],
      permission: { ses_keep: [{ id: "p1" }], ses_gone: [{ id: "p2" }] },
      question: { ses_gone: [{ id: "q1" }] },
      session_status: { ses_keep: "idle", ses_gone: "busy" },
      session_error: { ses_gone: { message: "stale" } },
      session_risk: { ses_gone: { quality: null } },
      session_goal: { ses_gone: { objective: "old" } },
      session_diff: { ses_gone: [{ path: "x.ts" }] },
      todo: { ses_keep: [{ id: "t1" }], ses_gone: [{ id: "t2" }] },
      message: {
        ses_keep: [{ id: "msg_keep" }],
        ses_gone: [{ id: "msg_gone" }],
      },
      part: {
        msg_keep: [{ id: "part_keep" }],
        msg_gone: [{ id: "part_gone" }],
      },
    }

    pruneOrphanSessionRecords(store)

    expect(store.permission.ses_gone).toBeUndefined()
    expect(store.question.ses_gone).toBeUndefined()
    expect(store.session_status.ses_gone).toBeUndefined()
    expect(store.session_error.ses_gone).toBeUndefined()
    expect(store.session_risk.ses_gone).toBeUndefined()
    expect(store.session_goal.ses_gone).toBeUndefined()
    expect(store.session_diff.ses_gone).toBeUndefined()
    expect(store.todo.ses_gone).toBeUndefined()
    expect(store.message.ses_gone).toBeUndefined()
    expect(store.part.msg_gone).toBeUndefined()
    expect(store.permission.ses_keep).toEqual([{ id: "p1" }])
    expect(store.message.ses_keep).toEqual([{ id: "msg_keep" }])
    expect(store.part.msg_keep).toEqual([{ id: "part_keep" }])
  })
})
