import { describe, expect, test } from "vitest"
import { applyHeadlessProjectionEvent, createHeadlessProjectionState } from "../../../src/runtime/headless/projection"
import { applySessionLeavePrune } from "../../../src/cli/tui/context/sync-session-store"

type Message = { id: string; sessionID: string }
type Part = { id: string; messageID: string; sessionID: string; type: "text"; text: string }
function fixture() {
  const state = createHeadlessProjectionState<{ id: string }, unknown, unknown, unknown, Message, Part>()
  const message = (id: string) =>
    applyHeadlessProjectionEvent(
      state,
      {
        type: "message.updated",
        properties: { info: { id, sessionID: "session" } },
      },
      { maxSessionMessages: 2 },
    )
  const part = (id: string, text = "snapshot") =>
    applyHeadlessProjectionEvent(state, {
      type: "message.part.updated",
      properties: { part: { id: `part_${id}`, messageID: id, sessionID: "session", type: "text", text } },
    })
  return { state, message, part }
}

describe("transcript retention regressions", () => {
  test("late snapshots cannot resurrect parts from evicted messages", () => {
    const { state, message, part } = fixture()
    message("m1")
    part("m1")
    message("m2")
    message("m3")
    part("m1", "late compaction snapshot")
    expect(state.part.m1).toBeUndefined()
    expect(state.message.session.map((item) => item.id)).toEqual(["m2", "m3"])
  })

  test("leave clears part-before-message snapshots and their pending delta protection", () => {
    const { state, message, part } = fixture()
    part("m1", "hello")
    applyHeadlessProjectionEvent(state, {
      type: "message.part.delta",
      properties: { sessionID: "session", messageID: "m1", partID: "part_m1", field: "text", delta: " world" },
    })
    applySessionLeavePrune(state, "session")
    expect(state.part).toEqual({})
    message("m1")
    part("m1", "hello world")
    part("m1", "hello")
    expect(state.part.m1[0].text).toBe("hello")
  })

  test("part-before-message ordering still yields the complete transcript", () => {
    const { state, message, part } = fixture()
    part("m1", "hello")
    message("m1")
    expect(state.part.m1[0].text).toBe("hello")
  })

  test("session deletion clears parts before their message arrives", () => {
    const { state, part } = fixture()
    part("m1")
    applyHeadlessProjectionEvent(state, { type: "session.deleted", properties: { info: { id: "session" } } })
    expect(state.part).toEqual({})
  })

  test("unknown-message payloads have an aggregate bound", () => {
    const { state, part } = fixture()
    for (let index = 0; index < 150; index++) part(`pending_${index}`, "x".repeat(16 * 1024))
    const payloadBytes = Object.values(state.part)
      .flat()
      .reduce((sum, item) => sum + Buffer.byteLength(item.text), 0)
    expect(Object.keys(state.part).length).toBeLessThanOrEqual(128)
    expect(payloadBytes).toBeLessThanOrEqual(1024 * 1024)
  })
})

// These assertions measure retained serialized payload, not process RSS.
import { enforceTranscriptBudget, refreshProjectionSizes } from "../../../src/runtime/headless/projection-retention"
import { applySessionSyncSnapshot } from "../../../src/cli/tui/context/sync-session-store"

describe("whole-message byte budget", () => {
  test("evicts oldest whole messages and preserves an oversized newest message visibly", () => {
    const { state, message, part } = fixture()
    const bounded = Object.assign(state, { message_truncated: {}, message_memory_limited: {} })
    message("m1")
    part("m1", "x".repeat(1000))
    message("m2")
    part("m2", "y".repeat(1000))
    const result = enforceTranscriptBudget(bounded, "session", { maxBytes: 500 })
    expect(state.message.session.map((item) => item.id)).toEqual(["m2"])
    expect(state.part.m1).toBeUndefined()
    expect(state.part.m2[0].text).toHaveLength(1000)
    expect(bounded.message_truncated).toEqual({ session: true })
    expect(bounded.message_memory_limited).toEqual({ session: true })
    expect(result.limited).toBe(true)
  })

  test("keeps recovered Undo history and reports its soft budget exception", () => {
    const { state, message, part } = fixture()
    message("m1")
    part("m1", "x".repeat(1000))
    message("m2")
    part("m2", "y".repeat(1000))
    expect(enforceTranscriptBudget(state, "session", { maxBytes: 500, preserve: true }).limited).toBe(true)
    expect(state.message.session).toHaveLength(2)
    expect(state.part.m1[0].text).toHaveLength(1000)
  })

  test("replacement removes stale size and delta bookkeeping", () => {
    const { state, message, part } = fixture()
    message("m1")
    part("m1", "x".repeat(10000))
    applyHeadlessProjectionEvent(state, {
      type: "message.part.delta",
      properties: { sessionID: "session", messageID: "m1", partID: "part_m1", field: "text", delta: " world" },
    })
    applySessionSyncSnapshot(state, "session", {
      session: { id: "session" },
      todo: [],
      diff: [],
      messages: [{ info: { id: "m1", sessionID: "session" }, parts: [] }],
    })
    expect(enforceTranscriptBudget(state, "session", { maxBytes: 500 }).bytes).toBeLessThan(500)
    part("m1", "x".repeat(10000) + " world")
    part("m1", "x")
    expect(state.part.m1[0].text).toBe("x")
  })

  test("delta accounting agrees with authoritative serialized sizes including Unicode and escaping", () => {
    const { state, message, part } = fixture()
    message("m1")
    part("m1", "start")
    applyHeadlessProjectionEvent(state, {
      type: "message.part.delta",
      properties: { sessionID: "session", messageID: "m1", partID: "part_m1", field: "text", delta: '\n"\\🦋' },
    })
    const incremental = enforceTranscriptBudget(state, "session").bytes
    refreshProjectionSizes(state, "session")
    expect(enforceTranscriptBudget(state, "session").bytes).toBe(incremental)
  })

  test("split surrogate delta accounting heals into the same Unicode payload size", () => {
    const { state, message, part } = fixture()
    message("m1")
    part("m1", "")
    for (const delta of ["\ud83e", "\udd8b"]) {
      applyHeadlessProjectionEvent(state, {
        type: "message.part.delta",
        properties: { sessionID: "session", messageID: "m1", partID: "part_m1", field: "text", delta },
      })
    }
    expect(state.part.m1[0].text).toBe("🦋")
    const incremental = enforceTranscriptBudget(state, "session").bytes
    refreshProjectionSizes(state, "session")
    expect(enforceTranscriptBudget(state, "session").bytes).toBe(incremental)
  })
})
