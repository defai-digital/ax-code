import { describe, expect, test } from "bun:test"
import { __internals } from "../../../src/cli/cmd/tui/debug/effect-tracer"

const { createTracer, observe, LOOP_WINDOW_MS, LOOP_THRESHOLD, LOOP_THROTTLE_MS } = __internals

describe("effect-tracer loop detector", () => {
  test("does not fire below the per-window threshold", () => {
    const state = createTracer("route.session")
    const base = 1_700_000_000_000
    let fired = false
    for (let i = 0; i < LOOP_THRESHOLD - 1; i++) {
      if (observe(state, base + i)) fired = true
    }
    expect(fired).toBe(false)
    expect(state.window.length).toBe(LOOP_THRESHOLD - 1)
  })

  test("fires once when the threshold is crossed inside the window", () => {
    const state = createTracer("route.session")
    const base = 1_700_000_000_000
    let fires = 0
    // Pack more than the threshold into a single 1s window.
    for (let i = 0; i < LOOP_THRESHOLD + 10; i++) {
      if (observe(state, base + i)) fires++
    }
    expect(fires).toBe(1)
  })

  test("respects wall-clock throttle between alerts", () => {
    const state = createTracer("route.session")
    const base = 1_700_000_000_000
    let fires = 0
    // First burst — one alert.
    for (let i = 0; i < LOOP_THRESHOLD + 5; i++) {
      if (observe(state, base + i)) fires++
    }
    expect(fires).toBe(1)
    // Immediately pack another burst within the throttle window — no alert.
    for (let i = 0; i < LOOP_THRESHOLD + 5; i++) {
      if (observe(state, base + 200 + i)) fires++
    }
    expect(fires).toBe(1)
    // After the throttle passes, another burst should alert again.
    const after = base + LOOP_THROTTLE_MS + 100
    for (let i = 0; i < LOOP_THRESHOLD + 5; i++) {
      if (observe(state, after + i)) fires++
    }
    expect(fires).toBe(2)
  })

  test("prunes observations older than the window", () => {
    const state = createTracer("route.session")
    const base = 1_700_000_000_000
    // Pack entries at base+0..49.
    for (let i = 0; i < 50; i++) observe(state, base + i)
    expect(state.window.length).toBe(50)
    // Jump far enough past the window that every prior entry falls outside.
    // cutoff = now - LOOP_WINDOW_MS must be > base + 49.
    observe(state, base + 49 + LOOP_WINDOW_MS + 1)
    expect(state.window.length).toBe(1)
  })

  test("tracedEffect accepts both labeled and unlabeled overloads without throwing", async () => {
    // Solid's reactive scheduler doesn't run inside `bun test` the same way
    // it does at runtime (no render context), so this test only verifies the
    // overload signatures are wired correctly and don't throw on call. The
    // observe/burst/throttle behavior is covered by the unit tests above.
    const { tracedEffect, tracedMemo } = await import("../../../src/cli/cmd/tui/debug/effect-tracer")
    const { createRoot } = await import("solid-js")
    let dispose: () => void = () => {}
    expect(() =>
      createRoot((d) => {
        dispose = d
        tracedEffect("test.labeled", () => {})
        tracedEffect(() => {})
        tracedMemo("test.labeled.memo", () => 1)
        tracedMemo(() => 1)
      }),
    ).not.toThrow()
    dispose()
  })
})
