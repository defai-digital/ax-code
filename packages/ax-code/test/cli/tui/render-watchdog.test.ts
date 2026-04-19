import { describe, expect, test } from "bun:test"
import { __internals } from "../../../src/cli/cmd/tui/debug/render-watchdog"

const { createState, observe, RENDER_LOOP_WINDOW_MS, RENDER_LOOP_THRESHOLD, RENDER_LOOP_THROTTLE_MS } = __internals

// createState() seeds windowStartedAt with Date.now(); to use deterministic
// fake timestamps, the tests reset windowStartedAt to align with `base`.
function freshState(base: number) {
  const state = createState()
  state.windowStartedAt = base
  state.count = 0
  state.lastAlertAt = 0
  return state
}

describe("render-watchdog observer", () => {
  test("does not fire below threshold", () => {
    const base = 1_700_000_000_000
    const state = freshState(base)
    let fires = 0
    for (let i = 0; i < RENDER_LOOP_THRESHOLD - 1; i++) {
      if (observe(state, base + i)) fires++
    }
    expect(fires).toBe(0)
  })

  test("fires once when threshold is crossed inside the window", () => {
    const base = 1_700_000_000_000
    const state = freshState(base)
    let fires = 0
    for (let i = 0; i < RENDER_LOOP_THRESHOLD + 10; i++) {
      if (observe(state, base + i)) fires++
    }
    expect(fires).toBe(1)
  })

  test("respects wall-clock throttle between alerts", () => {
    const base = 1_700_000_000_000
    const state = freshState(base)
    let fires = 0
    for (let i = 0; i < RENDER_LOOP_THRESHOLD + 5; i++) {
      if (observe(state, base + i)) fires++
    }
    expect(fires).toBe(1)
    // Jump just past one window so a fresh window starts; pack again — still
    // throttled because wall-clock < THROTTLE_MS since the last alert.
    const burst2 = base + RENDER_LOOP_WINDOW_MS + 5
    for (let i = 0; i < RENDER_LOOP_THRESHOLD + 5; i++) {
      if (observe(state, burst2 + i)) fires++
    }
    expect(fires).toBe(1)
    // After throttle elapses, allow another alert.
    const after = base + RENDER_LOOP_THROTTLE_MS + 100
    for (let i = 0; i < RENDER_LOOP_THRESHOLD + 5; i++) {
      if (observe(state, after + i)) fires++
    }
    expect(fires).toBe(2)
  })

  test("rolls the window every WINDOW_MS, resetting count", () => {
    const base = 1_700_000_000_000
    const state = freshState(base)
    for (let i = 0; i < 50; i++) observe(state, base + i)
    expect(state.count).toBe(50)
    // First observation past the window resets and counts as 1.
    observe(state, base + RENDER_LOOP_WINDOW_MS + 1)
    expect(state.count).toBe(1)
  })

  test("captureCallerStack returns the user frames excluding the wrapper", () => {
    const { captureCallerStack } = __internals
    function userFrame() {
      return captureCallerStack(10)
    }
    const stack = userFrame()
    expect(Array.isArray(stack)).toBe(true)
    // The captured stack must not surface our own wrapper frames.
    for (const frame of stack) {
      expect(frame).not.toContain("render-watchdog")
      expect(frame).not.toContain("captureCallerStack")
    }
    // Either we got at least one user frame, or the runtime suppressed
    // stack lines entirely — both are acceptable, but if there are frames
    // the test frame itself should appear among them.
    if (stack.length > 0) {
      expect(stack.some((frame) => frame.includes("userFrame") || frame.includes("render-watchdog.test"))).toBe(true)
    }
  })
})
