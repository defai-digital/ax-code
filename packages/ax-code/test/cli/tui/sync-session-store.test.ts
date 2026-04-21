import { describe, expect, test } from "bun:test"
import {
  applySessionDeleteCleanup,
  applySessionSyncSnapshot,
  createSessionSyncSnapshot,
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
      }),
    ).toEqual({
      session: { id: "ses_1", title: "current" },
      todo: [],
      messages: [],
      diff: [],
      risk: undefined,
    })
  })

  test("hydrates session state and removes stale part buckets on full sync", () => {
    const store: {
      session: Array<{ id: string; title: string }>
      todo: Record<string, Array<{ id: string }>>
      message: Record<string, Array<{ id: string }>>
      part: Record<string, Array<{ id: string; text: string }>>
      session_diff: Record<string, Array<{ path: string }>>
      session_risk: Record<string, { quality?: unknown }>
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
    })
  })

  test("removes all session-scoped data and message parts when a session is deleted", () => {
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
})
