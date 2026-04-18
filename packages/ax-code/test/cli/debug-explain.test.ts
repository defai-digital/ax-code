import { describe, expect, test } from "bun:test"
import {
  classifyProcessIssues,
  classifyReplayIssues,
  parseProcessEventLines,
  parseReplayEventLines,
} from "../../src/cli/cmd/debug/explain"

describe("debug explain replay hang analysis", () => {
  test("classifies bash timeouts from replay metadata", () => {
    const lines = [
      JSON.stringify({
        kind: "replay.event",
        time: "2026-04-15T12:00:00.000Z",
        sessionID: "ses_timeout",
        eventType: "tool.call",
        event: {
          type: "tool.call",
          sessionID: "ses_timeout",
          tool: "bash",
          callID: "call_1",
          input: {},
        },
      }),
      JSON.stringify({
        kind: "replay.event",
        time: "2026-04-15T12:00:10.000Z",
        sessionID: "ses_timeout",
        eventType: "tool.result",
        event: {
          type: "tool.result",
          sessionID: "ses_timeout",
          tool: "bash",
          callID: "call_1",
          status: "completed",
          output: "",
          durationMs: 10_000,
          metadata: {
            hang: {
              timedOut: true,
              timeoutMs: 5_000,
              lastOutputAt: Date.parse("2026-04-15T12:00:07.000Z"),
              signal: "SIGTERM",
            },
          },
        },
      }),
    ]

    const records = parseReplayEventLines(lines)
    const issues = classifyReplayIssues(records, Date.parse("2026-04-15T12:00:20.000Z"))

    expect(issues).toHaveLength(1)
    expect(issues[0]?.category).toBe("Hang")
    expect(issues[0]?.title).toContain("Bash command timed out")
    expect(issues[0]?.rootCause).toContain("ses_timeout")
    expect(issues[0]?.rootCause).toContain("5s")
  })

  test("classifies stalled sessions with an active tool call", () => {
    const lines = [
      JSON.stringify({
        kind: "replay.event",
        time: "2026-04-15T12:00:00.000Z",
        sessionID: "ses_stalled",
        eventType: "tool.call",
        event: {
          type: "tool.call",
          sessionID: "ses_stalled",
          tool: "read",
          callID: "call_2",
          input: {},
        },
      }),
    ]

    const records = parseReplayEventLines(lines)
    const issues = classifyReplayIssues(records, Date.parse("2026-04-15T12:01:00.000Z"))

    expect(issues).toHaveLength(1)
    expect(issues[0]?.category).toBe("Hang")
    expect(issues[0]?.title).toContain("Session appears stalled in read")
    expect(issues[0]?.rootCause).toContain("tool.result")
  })

  test("classifies TUI startup failures from process diagnostics", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.100Z",
        eventType: "tui.threadTransportSelected",
        data: { mode: "internal" },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.200Z",
        eventType: "tui.native.started",
        data: { hasEventSource: true },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:01.000Z",
        eventType: "tui.native.startupFailed",
        data: { error: { message: "Unable to load session bootstrap" } },
      }),
    ]

    const records = parseProcessEventLines(lines)
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:05.000Z"))

    expect(issues.some((issue) => issue.title.includes("TUI startup failed"))).toBeTrue()
    expect(issues[0]?.rootCause).toContain("Unable to load session bootstrap")
  })

  test("classifies TUI backend request failures and blank startup stalls", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.050Z",
        eventType: "tui.threadTransportSelected",
        data: { mode: "external" },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.100Z",
        eventType: "tui.native.started",
        data: { hasEventSource: false },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:01.000Z",
        eventType: "tui.native.httpError",
        data: { method: "GET", pathname: "/session/status", status: 503 },
      }),
    ]

    const records = parseProcessEventLines(lines)
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:20.000Z"))

    expect(issues.some((issue) => issue.title.includes("TUI backend requests failed"))).toBeTrue()
    expect(issues.some((issue) => issue.title.includes("never painted a first frame"))).toBeTrue()
  })
})
