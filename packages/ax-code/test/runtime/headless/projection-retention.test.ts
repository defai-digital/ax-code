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

  test("message.removed raises the session floor so later parts cannot resurrect the message", () => {
    const { state, message, part } = fixture()
    message("m1")
    part("m1")
    applyHeadlessProjectionEvent(state, {
      type: "message.removed",
      properties: { sessionID: "session", messageID: "m1" },
    })
    expect(state.message.session).toEqual([])
    expect(state.part.m1).toBeUndefined()
    part("m1", "late snapshot")
    expect(state.part.m1).toBeUndefined()
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

  test("a pending message evicted for the aggregate bound cannot be resurrected by its own later parts", () => {
    const { state, part } = fixture()
    // Fill the pending-message-count cap exactly (small payloads so only the
    // 128-message cap triggers, not the 1MB byte cap).
    for (let index = 0; index < 128; index++) part(`pending_${index}`)
    expect(Object.keys(state.part).length).toBe(128)

    // One more pending message tips it over the cap; pending_0 (oldest) is evicted.
    part("pending_128")
    expect(state.part.pending_0).toBeUndefined()
    expect(Object.keys(state.part).length).toBe(128)

    // A further part update for the evicted messageID must stay rejected
    // (its message record never arrived) instead of being re-admitted and
    // bumping out a different, still-legitimately-pending message.
    part("pending_0")
    expect(state.part.pending_0).toBeUndefined()
    expect(state.part.pending_1).toBeDefined()
    expect(Object.keys(state.part).length).toBe(128)
  })
})

// These assertions measure retained serialized payload, not process RSS.
import {
  enforceTranscriptBudget,
  refreshProjectionSizes,
  adaptiveTranscriptMaxBytes,
  MAX_TRANSCRIPT_BYTES,
  MAX_TRANSCRIPT_BYTES_PRESSURE_FLOOR,
} from "../../../src/runtime/headless/projection-retention"
import { applySessionSyncSnapshot } from "../../../src/cli/tui/context/sync-session-store"

describe("adaptiveTranscriptMaxBytes", () => {
  test("returns the full budget below the pressure band", () => {
    expect(adaptiveTranscriptMaxBytes(0)).toBe(MAX_TRANSCRIPT_BYTES)
    expect(adaptiveTranscriptMaxBytes(0.5)).toBe(MAX_TRANSCRIPT_BYTES)
    expect(adaptiveTranscriptMaxBytes(Number.NaN)).toBe(MAX_TRANSCRIPT_BYTES)
  })

  test("interpolates inside the pressure band and floors past its end", () => {
    const midpoint = adaptiveTranscriptMaxBytes(0.7)
    expect(midpoint).toBeLessThan(MAX_TRANSCRIPT_BYTES)
    expect(midpoint).toBeGreaterThan(MAX_TRANSCRIPT_BYTES_PRESSURE_FLOOR)
    expect(adaptiveTranscriptMaxBytes(0.9)).toBe(MAX_TRANSCRIPT_BYTES_PRESSURE_FLOOR)
    expect(adaptiveTranscriptMaxBytes(1)).toBe(MAX_TRANSCRIPT_BYTES_PRESSURE_FLOOR)
  })
})

describe("session leave prune", () => {
  test("drops session_error and message flag bags but keeps interactive maps and status", () => {
    const { state, message } = fixture()
    const withBags = Object.assign(state, {
      session_error: { session: { message: "boom" } },
      session_status: { session: { type: "busy" } },
      message_truncated: { session: true },
      message_reload: { session: true },
      message_memory_limited: { session: true },
    })
    message("m1")
    applySessionLeavePrune(withBags, "session")
    expect(withBags.session_error).toEqual({})
    // ADR-047 D3: the live status map survives navigation with permission/question.
    expect(withBags.session_status).toEqual({ session: { type: "busy" } })
    expect(withBags.message_truncated).toEqual({})
    expect(withBags.message_reload).toEqual({})
    expect(withBags.message_memory_limited).toEqual({})
    expect(state.message.session).toBeUndefined()
  })
})

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
