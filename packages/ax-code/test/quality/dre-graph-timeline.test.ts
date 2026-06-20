import { describe, expect, test } from "vitest"
import { parseDreGraphTimeline, parseDreGraphTimelineStepDurationMs } from "../../src/quality/dre-graph-timeline"
import type { SessionDre } from "../../src/session/dre"

describe("quality.dre-graph-timeline", () => {
  test("parses headings, metadata, steps, tools, routes, llms, and errors", () => {
    const lines: SessionDre.TimelineLine[] = [
      { kind: "heading", text: "Session timeline" },
      { kind: "meta", text: "model test/model" },
      { kind: "tool", text: "ignored before first step -> ok (1ms)" },
      { kind: "step", text: "Step 0 · 1m 02s · tokens 3/5" },
      { kind: "route", text: "build -> debug" },
      { kind: "llm", text: "provider call" },
      { kind: "tool", text: "read: README.md → ok (6ms)" },
      { kind: "tool", text: "bash → ERR (17ms)" },
      { kind: "tool", text: "malformed tool line" },
      { kind: "error", text: "tool failed" },
      { kind: "step", text: "Step 1 · 7s · tokens 8/13" },
      { kind: "tool", text: "grep: src → ok" },
    ]

    expect(parseDreGraphTimeline(lines)).toEqual({
      header: { kind: "heading", text: "Session timeline" },
      meta: [{ kind: "meta", text: "model test/model" }],
      steps: [
        {
          index: "Step 0",
          duration: "1m 02s",
          tokens: "tokens 3/5",
          routes: ["build -> debug"],
          llms: ["provider call"],
          errors: ["tool failed"],
          tools: [
            { name: "read", args: "README.md", status: "ok", durationMs: 6 },
            { name: "bash", args: "", status: "ERR", durationMs: 17 },
            { name: "malformed tool line", args: "", status: "ok", durationMs: 0 },
          ],
        },
        {
          index: "Step 1",
          duration: "7s",
          tokens: "tokens 8/13",
          routes: [],
          llms: [],
          errors: [],
          tools: [{ name: "grep", args: "src", status: "ok", durationMs: 0 }],
        },
      ],
    })
  })

  test("parses step durations for gantt proportional bars", () => {
    expect(parseDreGraphTimelineStepDurationMs("1m 05s")).toBe(65_000)
    expect(parseDreGraphTimelineStepDurationMs("9s")).toBe(9_000)
    expect(parseDreGraphTimelineStepDurationMs("unknown")).toBe(0)
  })
})
