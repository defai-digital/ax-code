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

  test("classifies tui state burst events as a reducer loop", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:01.000Z",
        eventType: "tui.state.heartbeat",
        data: { counters: { dispatches: 4, commits: 4, bursts: 0 } },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:02.000Z",
        eventType: "tui.state.burstDetected",
        data: { topAction: "queue.measured", topCount: 61, commits: 61, windowMs: 500 },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:07.000Z",
        eventType: "tui.state.burstDetected",
        data: { topAction: "queue.measured", topCount: 74, commits: 74, windowMs: 500 },
      }),
    ]

    const records = parseProcessEventLines(lines)
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:10.000Z"))

    const burstIssue = issues.find((issue) => issue.title.includes("cycling on a single action"))
    expect(burstIssue).toBeTruthy()
    expect(burstIssue?.severity).toBe("critical")
    expect(burstIssue?.occurrences).toBe(2)
    expect(burstIssue?.rootCause).toContain("queue.measured")
    expect(burstIssue?.rootCause).toContain("74")
  })

  test("flags a stopped heartbeat as a stalled main thread", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:01.000Z",
        eventType: "tui.state.heartbeat",
        data: { counters: { dispatches: 2, commits: 2, bursts: 0 } },
      }),
    ]

    const records = parseProcessEventLines(lines)
    // Now is 40s after the last heartbeat — well past the 30s stall threshold.
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:41.000Z"))

    const stallIssue = issues.find((issue) => issue.title.includes("heartbeat stopped"))
    expect(stallIssue).toBeTruthy()
    expect(stallIssue?.severity).toBe("critical")
    expect(stallIssue?.rootCause).toContain("40s")
  })

  test("does not flag heartbeat stall when tui stopped normally", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:01.000Z",
        eventType: "tui.state.heartbeat",
        data: { counters: { dispatches: 2, commits: 2, bursts: 0 } },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:02.000Z",
        eventType: "tui.native.stopped",
        data: {},
      }),
    ]

    const records = parseProcessEventLines(lines)
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:41.000Z"))
    expect(issues.some((issue) => issue.title.includes("heartbeat stopped"))).toBeFalse()
  })
})
