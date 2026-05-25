import { describe, test, expect } from "bun:test"
import {
  createHeadlessProjectionState,
  applyHeadlessProjectionEvent,
  isHeadlessRuntimeEvent,
  HEADLESS_RUNTIME_EVENT_TYPES,
} from "../src/headless.js"

describe("headless SDK types", () => {
  test("HEADLESS_RUNTIME_EVENT_TYPES includes session.error", () => {
    expect(HEADLESS_RUNTIME_EVENT_TYPES.has("session.error")).toBe(true)
  })

  test("isHeadlessRuntimeEvent recognizes known types", () => {
    expect(isHeadlessRuntimeEvent({ type: "session.created", properties: {} })).toBe(true)
    expect(isHeadlessRuntimeEvent({ type: "session.error", properties: {} })).toBe(true)
    expect(isHeadlessRuntimeEvent({ type: "unknown.event" })).toBe(false)
    expect(isHeadlessRuntimeEvent(null)).toBe(false)
  })

  test("createHeadlessProjectionState has session_error", () => {
    const state = createHeadlessProjectionState()
    expect(state.session_error).toEqual({})
  })

  test("applyHeadlessProjectionEvent handles session.error", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    const result = applyHeadlessProjectionEvent(state, {
      type: "session.error",
      properties: { sessionID: "sess-1", error: { message: "Provider failed" } },
    })
    expect(result.handled).toBe(true)
    expect(state.session_error["sess-1"]).toEqual({ message: "Provider failed" })
  })

  test("session.deleted clears session_error", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    applyHeadlessProjectionEvent(state, {
      type: "session.error",
      properties: { sessionID: "sess-1", error: "oops" },
    })
    applyHeadlessProjectionEvent(state, {
      type: "session.deleted",
      properties: { info: { id: "sess-1" } },
    })
    expect(state.session_error["sess-1"]).toBeUndefined()
  })

  test("permission.asked goes to supervised queue when autonomous is false", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    const perm = { id: "req-1", sessionID: "sess-1", type: "bash", title: "Run command", description: "", command: "ls" } as any
    applyHeadlessProjectionEvent(state, { type: "permission.asked", properties: perm })
    expect(state.permission["sess-1"]).toHaveLength(1)
  })

  test("permission.asked auto-replies when autonomous is true", () => {
    const state = createHeadlessProjectionState<
      { id: string },
      unknown,
      unknown,
      unknown,
      { id: string; sessionID: string },
      { id: string; messageID: string }
    >()
    const perm = { id: "req-1", sessionID: "sess-1", type: "bash", title: "Run", description: "", command: "ls" } as any
    const result = applyHeadlessProjectionEvent(
      state,
      { type: "permission.asked", properties: perm },
      { autonomous: true },
    )
    expect(result.effects).toHaveLength(1)
    expect(result.effects[0].type).toBe("permission.auto_reply")
    expect(state.permission["sess-1"] ?? []).toHaveLength(0)
  })
})
