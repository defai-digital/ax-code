import { describe, expect, test } from "vitest"
import { SessionRollback } from "@/session/rollback"
import { SessionRollbackView } from "@/cli/cmd/tui/routes/session/rollback"
import type { ReplayEvent } from "@/replay/event"

// Perf fix (finding 12): the sidebar rollback memo used to run two full
// event-log loads plus an ExecutionGraph build per assistant step. It now uses
// SessionRollbackView.points, which resolves step points from ONLY the indexed
// "step.start" events and skips the graph build. These tests prove that
// filtering the log down to step.start events produces identical step points
// (SessionRollback.resolve already ignores every other event type), and that
// the sidebar's rendered output (summary + length) only depends on that cheap
// subset.

const msgs: SessionRollback.Message = [
  { info: { id: "u0", role: "user" }, parts: [{ id: "up", type: "text" }] },
  {
    info: { id: "m1", role: "assistant", parentID: "u0" },
    parts: [
      { id: "s1a", type: "step-start" },
      { id: "t1", type: "tool" },
      { id: "s1b", type: "step-start" },
    ],
  },
  {
    info: { id: "m2", role: "assistant", parentID: "u0" },
    parts: [{ id: "s2a", type: "step-start" }],
  },
]

function ev(event: Partial<ReplayEvent> & { type: string }): ReplayEvent {
  return { sessionID: "s1", ...event } as unknown as ReplayEvent
}

// A realistic mixed log: step.start events interleaved with the noisy
// (potentially megabyte) event types the old full-log load paid for.
const fullLog: ReplayEvent[] = [
  ev({ type: "session.start" }),
  ev({ type: "step.start", messageID: "m1", stepIndex: 0 }),
  ev({ type: "tool.call", messageID: "m1" }),
  ev({ type: "tool.result", messageID: "m1" }),
  ev({ type: "step.start", messageID: "m1", stepIndex: 1 }),
  ev({ type: "llm.response", messageID: "m1" }),
  ev({ type: "step.start", messageID: "m2", stepIndex: 0 }),
]

const stepStartOnly = fullLog.filter((e) => e.type === "step.start")

describe("sidebar rollback points-only path", () => {
  test("resolving from step.start-only events matches resolving from the full log", () => {
    const fromFull = SessionRollback.resolve(msgs, fullLog)
    const fromFiltered = SessionRollback.resolve(msgs, stepStartOnly)
    expect(fromFiltered).toEqual(fromFull)
  })

  test("resolved points carry the expected step numbers and message ids", () => {
    const points = SessionRollback.resolve(msgs, stepStartOnly)
    expect(points.map((p) => p.step)).toEqual([1, 2, 3])
    expect(points.map((p) => p.messageID)).toEqual(["m1", "m1", "m2"])
    expect(points.map((p) => p.partID)).toEqual(["s1a", "s1b", "s2a"])
  })

  test("sidebar summary depends only on step count + numbers (no graph detail)", () => {
    // The graph-derived detail path attaches tools/kinds/duration; the sidebar
    // only renders SessionRollbackView.summary, which reads length + step.
    const points = SessionRollback.resolve(msgs, stepStartOnly)
    expect(SessionRollbackView.summary(points)).toBe("rollback points: 3 steps (1 → 3)")
    expect(SessionRollbackView.summary(points.slice(0, 1))).toBe("rollback point: step 1")
    expect(SessionRollbackView.summary([])).toBeUndefined()
  })
})
