import { describe, expect, test } from "vitest"
import {
  applyHeadlessProjectionEvent,
  createHeadlessProjectionState,
} from "../../../src/runtime/headless"
import { streamPaintDecision } from "../../../src/cli/cmd/tui/routes/session/stream-paint"

// Behavior test for the streaming pipeline (principle D of the 2026-08-13
// Kimi review: "did the screen keep up with the backend"). Drives the real
// headless projection exactly the way the TUI store does — interleaved text
// deltas and full part snapshots — and asserts:
//   1. the projected text converges to the full backend stream at finalize
//   2. the part keeps object identity the whole way (a replace remounts the
//      whole message row in the TUI — the streaming remount storm)
//   3. a paint loop driven by streamPaintDecision stays bounded (no paint
//      per delta) and paints immediately on final
// A full PTY "type during stream" test needs a scripted SSE backend harness
// and is tracked as follow-up; vitest resolves solid-js to its SSR server
// build (createEffect is a no-op there), so the reactive throttle hook
// itself cannot run here — its timing contract is covered by
// stream-paint.test.ts.

type Session = { id: string }
type Todo = { id: string }
type Diff = { path: string }
type Status = { type: "idle" | "busy" }
type Message = { id: string; sessionID: string; finish?: string }
type Part = { id: string; messageID: string; type?: string; text?: string }

describe("streaming screen convergence", () => {
  test("projection converges to the backend stream with stable identity and bounded paints", () => {
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()
    const apply = (event: unknown) => applyHeadlessProjectionEvent(state, event as never)

    const CHUNKS = 400
    let accumulated = ""
    apply({
      type: "message.part.updated",
      properties: { part: { id: "prt_1", messageID: "msg_1", type: "text", text: "" } },
    })
    const originalPart = state.part["msg_1"]?.[0]

    let paints = 0
    let lastPaintAt = 0
    let now = 0
    for (let i = 0; i < CHUNKS; i++) {
      accumulated += `tok${i} `
      now += 8 // deltas arrive every ~8ms, faster than the paint interval
      apply({
        type: "message.part.delta",
        properties: { sessionID: "ses_1", messageID: "msg_1", partID: "prt_1", field: "text", delta: `tok${i} ` },
      })
      // Server progress snapshot every 16ms, like partWriteBatcher.
      if (i % 2 === 1) {
        apply({
          type: "message.part.updated",
          properties: { part: { id: "prt_1", messageID: "msg_1", type: "text", text: accumulated } },
        })
      }
      const decision = streamPaintDecision({ final: false, now, lastPaintAt, length: accumulated.length })
      if (decision.action === "paint-now") {
        paints++
        lastPaintAt = now
      }
    }

    // Finalize: trimmed snapshot + finish. The projection's longer-text-wins
    // guard intentionally keeps the untrimmed stream text; the view layer
    // trims for display.
    apply({
      type: "message.part.updated",
      properties: { part: { id: "prt_1", messageID: "msg_1", type: "text", text: accumulated.trimEnd() } },
    })
    apply({
      type: "message.updated",
      properties: { info: { id: "msg_1", sessionID: "ses_1", finish: "stop" } },
    })
    const finalDecision = streamPaintDecision({
      final: true,
      now: now + 1,
      lastPaintAt,
      length: accumulated.length,
    })
    if (finalDecision.action === "paint-now") paints++

    // Convergence: the store ends exactly where the backend ended.
    expect(state.part["msg_1"]?.[0]?.text?.trimEnd()).toBe(accumulated.trimEnd())
    // Identity: one part object across 400 deltas + 200 snapshots.
    expect(state.part["msg_1"]?.[0]).toBe(originalPart)
    // Bounded paints: 600 store events at 8ms cadence over the scaled
    // interval (40–120ms) must mean a handful of paints, and final paints now.
    expect(finalDecision.action).toBe("paint-now")
    expect(paints).toBeLessThanOrEqual(Math.ceil(now / 40) + 1)
    expect(paints).toBeLessThan(100)
  })
})
