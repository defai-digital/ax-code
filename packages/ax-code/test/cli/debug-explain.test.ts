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

  test("classifies traced effect loops by label", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:02.000Z",
        eventType: "tui.effect.loopDetected",
        data: { label: "sync.routeSession", runs: 132, windowMs: 1000 },
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:07.000Z",
        eventType: "tui.effect.loopDetected",
        data: { label: "sync.routeSession", runs: 180, windowMs: 1000 },
      }),
    ]

    const records = parseProcessEventLines(lines)
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:10.000Z"))

    const issue = issues.find((i) => i.title.includes("reactive effect is cycling"))
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe("critical")
    expect(issue?.occurrences).toBe(2)
    expect(issue?.rootCause).toContain("sync.routeSession")
    expect(issue?.rootCause).toContain("180")
    expect(issue?.suggestedFix).toContain("tracedEffect")
  })

  test("classifies worker-side main-thread stall detection", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:05.000Z",
        eventType: "tui.worker.mainStalled",
        data: { gapMs: 4500, lastPingAt: "2026-04-18T12:00:00.500Z", thresholdMs: 2000 },
      }),
    ]

    const records = parseProcessEventLines(lines)
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:10.000Z"))

    const issue = issues.find((i) => i.title.includes("main thread stalled (worker watchdog)"))
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe("critical")
    // formatDuration rounds 4500ms to 5s.
    expect(issue?.rootCause).toContain("5s")
    expect(issue?.rootCause).toContain("2026-04-18T12:00:00.500Z")
  })

  test("classifies opentui render loops", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:02.000Z",
        eventType: "tui.render.loopDetected",
        data: { renders: 412, windowMs: 1000, windowStartedAt: "2026-04-18T12:00:01.000Z" },
      }),
    ]

    const records = parseProcessEventLines(lines)
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:10.000Z"))

    const issue = issues.find((i) => i.title.includes("renderer is repainting"))
    expect(issue).toBeTruthy()
    expect(issue?.severity).toBe("critical")
    expect(issue?.rootCause).toContain("412")
  })

  test("surfaces the caller stack from a render loop record", () => {
    const lines = [
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:00.000Z",
        eventType: "tui.threadStarted",
        data: {},
      }),
      JSON.stringify({
        kind: "process.event",
        time: "2026-04-18T12:00:02.000Z",
        eventType: "tui.render.loopDetected",
        data: {
          renders: 230,
          windowMs: 1000,
          windowStartedAt: "2026-04-18T12:00:01.000Z",
          stack: [
            "at PromptComponent (component/prompt/index.tsx:142:18)",
            "at SessionView (routes/session/index.tsx:230:5)",
            "at runEffect (solid-js/web/dist/index.js:1234:9)",
          ],
        },
      }),
    ]

    const records = parseProcessEventLines(lines)
    const issues = classifyProcessIssues(records, Date.parse("2026-04-18T12:00:10.000Z"))
    const issue = issues.find((i) => i.title.includes("renderer is repainting"))
    expect(issue).toBeTruthy()
    expect(issue?.rootCause).toContain("Caller stack at first burst")
    expect(issue?.rootCause).toContain("PromptComponent")
    expect(issue?.rootCause).toContain("SessionView")
    expect(issue?.suggestedFix).toContain("topmost user frame")
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
