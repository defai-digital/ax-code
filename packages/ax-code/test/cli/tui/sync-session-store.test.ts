import { describe, expect, test } from "vitest"
import { MAX_TRANSCRIPT_BYTES } from "../../../src/runtime/headless/projection-retention"
import {
  applyEarlierMessagePage,
  applySessionDeleteCleanup,
  applySessionLeavePrune,
  applySessionSyncEnrichment,
  applySessionSyncSnapshot,
  capSyncedMessages,
  createSessionSyncSnapshot,
  pruneOrphanSessionRecords,
} from "../../../src/cli/tui/context/sync-session-store"

describe("capSyncedMessages", () => {
  test("passes through results within the cap", () => {
    const messages = [{ id: "a" }, { id: "b" }]
    expect(capSyncedMessages(messages, 3)).toEqual({ messages, truncated: false })
  })

  test("treats exactly-at-cap as not truncated", () => {
    const messages = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(capSyncedMessages(messages, 3)).toEqual({ messages, truncated: false })
  })

  test("keeps the newest entries when the overflow probe trips", () => {
    const messages = [{ id: "oldest" }, { id: "b" }, { id: "c" }, { id: "newest" }]
    expect(capSyncedMessages(messages, 3)).toEqual({
      messages: [{ id: "b" }, { id: "c" }, { id: "newest" }],
      truncated: true,
    })
  })

  test("handles undefined input", () => {
    expect(capSyncedMessages(undefined, 3)).toEqual({ messages: undefined, truncated: false })
  })
})

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
        ses_1: [{ id: "msg_keep" }, { id: "msg_mid" }, { id: "msg_new" }],
      },
      part: {
        msg_mid: [{ id: "part_old", text: "remove" }],
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

describe("admitted transcript history", () => {
  const page = (start: number, length: number) =>
    Array.from({ length }, (_, i) => ({
      info: { id: `msg_${String(start + i).padStart(4, "0")}` },
      parts: [{ id: `part_${start + i}`, text: "stored" }],
    }))
  function state() {
    return {
      session: [{ id: "session" }] as Array<{ id: string; revert?: { messageID: string } }>,
      todo: {},
      message: { session: page(100, 100).map((item) => item.info) },
      part: {} as Record<string, Array<{ id: string; text: string }>>,
      session_diff: {},
      session_risk: {},
      session_goal: {},
      message_cursor: { session: "older" } as Record<string, string>,
      message_window: { session: 100 } as Record<string, number>,
      message_truncated: { session: true } as Record<string, boolean>,
    }
  }

  test.each(["C0", undefined])("a stale forced snapshot keeps the earlier page and cursor %s", (cursor) => {
    const store = state()
    // The forced fetch starts with the original 100-message window.
    const snapshot = {
      session: { id: "session" },
      todo: [],
      messages: page(100, 100),
      diff: [],
      history: { cursor: "C1" },
    }
    applyEarlierMessagePage(store, "session", page(0, 100), cursor, { maxMessages: 300 })
    expect(store.message.session).toHaveLength(200)

    applySessionSyncSnapshot(store, "session", snapshot)

    expect(store.message.session).toEqual(page(0, 200).map((item) => item.info))
    for (const item of page(0, 200)) expect(store.part[item.info.id]).toEqual(item.parts)
    expect(store.message_window.session).toBe(200)
    expect(store.message_cursor.session).toBe(cursor)
    expect(store.message_truncated.session).toBe(!!cursor)
  })

  test("a routine full-window resync does not grow the window from an overlapping prefix", () => {
    const store = state()
    applySessionSyncSnapshot(store, "session", {
      session: { id: "session" },
      todo: [],
      messages: page(101, 100),
      diff: [],
      history: { cursor: "before-msg_0101" },
    })
    expect(store.message.session).toEqual(page(101, 100).map((item) => item.info))
    expect(store.message_window.session).toBe(100)
    expect(store.message_cursor.session).toBe("before-msg_0101")
  })

  test("a forced snapshot keeps the admitted 200-message window and adopts its cursor", () => {
    const store = state()
    store.message_window.session = 200
    applySessionSyncSnapshot(store, "session", {
      session: { id: "session" },
      todo: [],
      messages: page(0, 200),
      diff: [],
      history: { cursor: "next-page" },
    })
    expect(store.message.session).toHaveLength(200)
    expect(store.part.msg_0000).toEqual(page(0, 1)[0].parts)
    expect(store.message_cursor.session).toBe("next-page")
    expect(store.message_truncated.session).toBe(true)
  })

  test("a snapshot with an absent oldest message replaces the prefix and adopts its cursor", () => {
    const store = state()
    store.message.session.unshift(page(0, 1)[0].info)
    store.part.msg_0000 = page(0, 1)[0].parts
    store.message_window.session = 200
    applySessionSyncSnapshot(store, "session", {
      session: { id: "session" },
      todo: [],
      messages: page(90, 110),
      diff: [],
      history: { cursor: "before-msg_0090" },
    })
    expect(store.message.session).toEqual(page(90, 110).map((item) => item.info))
    expect(store.part.msg_0000).toBeUndefined()
    expect(store.message_cursor.session).toBe("before-msg_0090")
    expect(store.message_truncated.session).toBe(true)
    expect(store.message_window.session).toBe(110)
  })

  test.each(["count", "bytes"])("eviction of a kept prefix by the %s budget drops its cursor", (budget) => {
    const store = state()
    applyEarlierMessagePage(store, "session", page(0, 100), "C0", { maxMessages: 300 })
    if (budget === "count") {
      store.message.session.push(...page(200, 101).map((item) => item.info))
    } else {
      store.part.msg_0000 = [{ id: "large", text: "x".repeat(MAX_TRANSCRIPT_BYTES) }]
    }
    applySessionSyncSnapshot(store, "session", {
      session: { id: "session" },
      todo: [],
      messages: page(100, 100),
      diff: [],
      history: { cursor: "C1" },
    })
    const length = budget === "count" ? 300 : 199
    expect(store.message.session).toHaveLength(length)
    expect(store.message.session[0].id).toBe("msg_0001")
    expect(store.part.msg_0000).toBeUndefined()
    expect(store.part.msg_0001).toEqual(page(1, 1)[0].parts)
    expect(store.message_cursor.session).toBeUndefined()
    expect(store.message_truncated.session).toBe(true)
    expect(store.message_window.session).toBe(length)
  })

  test("an active revert retains the existing snapshot replacement behavior", () => {
    const store = state()
    applyEarlierMessagePage(store, "session", page(0, 100), "C0", { maxMessages: 300 })
    const session = { id: "session", revert: { messageID: "msg_0050" } }
    store.session[0] = session
    applySessionSyncSnapshot(store, "session", {
      session,
      todo: [],
      messages: page(100, 100),
      diff: [],
      history: { cursor: "C1" },
    })
    expect(store.message.session).toEqual(page(100, 100).map((item) => item.info))
    expect(store.part.msg_0000).toBeUndefined()
    expect(store.message_cursor.session).toBe("C1")
    expect(store.message_window.session).toBe(200)
  })

  test("a snapshot whose oldest messages are evicted by live arrivals drops its cursor", () => {
    const store = state()
    // The fetch returned msg_0090..0189; msg_0190..0199 streamed in meanwhile.
    applySessionSyncSnapshot(store, "session", {
      session: { id: "session" },
      todo: [],
      messages: page(90, 100),
      diff: [],
      history: { cursor: "before-msg_0090" },
    })
    expect(store.message.session).toHaveLength(100)
    expect(store.message.session[0].id).toBe("msg_0100")
    expect(store.message_cursor.session).toBeUndefined()
    expect(store.message_truncated.session).toBe(true)
  })

  test("prepends and deduplicates pages without replacing live parts", () => {
    const store = state()
    store.part.msg_0100 = [{ id: "stream", text: "live" }]
    const older = [...page(0, 101), ...page(0, 1)]
    expect(applyEarlierMessagePage(store, "session", older, "next-page", { maxMessages: 300 })).toEqual({
      added: 100,
      evicted: 0,
    })
    expect(store.message.session).toHaveLength(200)
    expect(store.message.session[0].id).toBe("msg_0000")
    expect(store.part.msg_0100).toEqual([{ id: "stream", text: "live" }])
    expect(store.part.msg_0000).toEqual(older[0].parts)
    expect(store.message_window.session).toBe(200)
    expect(store.message_cursor.session).toBe("next-page")
    expect(store.message_truncated.session).toBe(true)
    expect(applyEarlierMessagePage(store, "session", older, undefined, { maxMessages: 300 })).toEqual({
      added: 0,
      evicted: 0,
    })
    expect(store.message_cursor.session).toBeUndefined()
    expect(store.message_truncated.session).toBe(false)
  })

  test("byte eviction drops parts and invalidates the older-page cursor", () => {
    const store = state()
    const result = applyEarlierMessagePage(store, "session", page(0, 100), "next-page", {
      maxMessages: 300,
      maxBytes: 1,
    })
    expect(result).toEqual({ added: 100, evicted: 199 })
    expect(store.part.msg_0000).toBeUndefined()
    expect(store.message_cursor.session).toBeUndefined()
    expect(store.message_truncated.session).toBe(true)
    expect(store.message_window.session).toBe(200)
  })

  test("preserves the undo window despite count and byte budgets", () => {
    const store = state()
    store.session[0].revert = { messageID: "msg_0050" }
    expect(
      applyEarlierMessagePage(store, "session", page(0, 100), "next-page", {
        maxMessages: 100,
        maxBytes: 1,
      }),
    ).toEqual({ added: 100, evicted: 0 })
    expect(store.message.session).toHaveLength(200)
    expect(store.message_cursor.session).toBe("next-page")
  })

  test.each(["leave", "delete", "orphan"])("%s pruning removes cursor and admitted window", (kind) => {
    const store = { ...state(), permission: {}, question: {}, session_status: {} }
    if (kind === "leave") applySessionLeavePrune(store, "session")
    if (kind === "delete") applySessionDeleteCleanup(store, "session")
    if (kind === "orphan") {
      store.session = []
      pruneOrphanSessionRecords(store)
    }
    expect(store.message_cursor.session).toBeUndefined()
    expect(store.message_window.session).toBeUndefined()
  })
})
