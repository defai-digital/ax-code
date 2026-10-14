import { describe, expect, test } from "vitest"

import { AuditReport, formatAuditReportTimestamp } from "../../src/audit/report"
import type { VerificationEnvelope } from "../../src/quality/verification-envelope"
import { Instance } from "../../src/project/instance"
import { EventQuery } from "../../src/replay/query"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

function envelope(input: {
  sessionID: string
  name: string
  type: VerificationEnvelope["result"]["type"]
  passed: boolean
}): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "qa",
    scope: { kind: "workspace" },
    command: { runner: input.name, argv: [input.name], cwd: "/tmp/work" },
    result: {
      name: input.name,
      type: input.type,
      passed: input.passed,
      status: input.passed ? "passed" : "failed",
      issues: [],
      duration: 0,
    },
    structuredFailures: [],
    artifactRefs: [],
    source: { tool: "verify_project", version: "4.x.x", runId: input.sessionID },
  }
}

describe("AuditReport.generate", () => {
  test("formats malformed report timestamps without throwing", () => {
    expect(formatAuditReportTimestamp(Date.parse("2026-04-01T00:00:00Z"))).toBe("2026-04-01 00:00:00")
    expect(formatAuditReportTimestamp(Number.NaN)).toBe("1970-01-01 00:00:00")
    expect(formatAuditReportTimestamp(Number.POSITIVE_INFINITY)).toBe("1970-01-01 00:00:00")
    expect(formatAuditReportTimestamp(8_640_000_000_000_001)).toBe("1970-01-01 00:00:00")
  })

  test("shows delegate and switch route entries distinctly", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)

        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "agent.route",
          sessionID: sid,
          fromAgent: "build",
          toAgent: "perf",
          confidence: 0.92,
          routeMode: "delegate",
          matched: ["performance", "profile"],
        })
        Recorder.emit({
          type: "agent.route",
          sessionID: sid,
          fromAgent: "build",
          toAgent: "security",
          confidence: 0.88,
          routeMode: "switch",
          matched: ["security", "scan"],
        })
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 0 })

        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        const report = await AuditReport.generate(sid)
        expect(report).toContain("## Routing")
        expect(report).toContain("delegate `build` -> `perf` (0.92) [performance, profile]")
        expect(report).toContain("switch `build` -> `security` (0.88) [security, scan]")

        EventQuery.deleteBySession(sid)
      },
    })
  })

  test("normalizes malformed legacy route and token fields", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)
        Recorder.emit({
          type: "agent.route",
          sessionID: sid,
          fromAgent: "build",
          toAgent: "review",
          confidence: "high",
          matched: "security",
        } as any)
        Recorder.emit({
          type: "llm.response",
          sessionID: sid,
          finishReason: "stop",
          tokens: {},
          latencyMs: "slow",
        } as any)
        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        const report = await AuditReport.generate(sid)
        expect(report).toContain("switch `build` -> `review` (0.00)")
        expect(report).toContain("- **Input:** 0")
        expect(report).toContain("- **Output:** 0")
        expect(report).toContain("- **Total:** 0")
        expect(report).not.toContain("NaN")

        EventQuery.deleteBySession(sid)
      },
    })
  })

  test("redacts credentials in the command line it logs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Audit report redaction" })
        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.call",
          sessionID: session.id,
          tool: "bash",
          callID: "call-secret",
          input: { command: "curl -H 'Authorization: Bearer super-secret-token' example.com" },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "bash",
          callID: "call-secret",
          status: "completed",
          output: "QUOTA_TOKEN=abc123 applied",
          durationMs: 3,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const report = await AuditReport.generate(session.id)
        expect(report).not.toContain("super-secret-token")
        expect(report).not.toContain("abc123")
      },
    })
  })

  test("orders the action log by when each tool call started", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Audit report action order" })
        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.call",
          sessionID: session.id,
          tool: "read",
          callID: "call-a",
          input: { filePath: "a.ts" },
        })
        // A distinct start time for the second call, so a result-order list is
        // visibly different from a start-order one.
        await new Promise((resolve) => setTimeout(resolve, 5))
        Recorder.emit({
          type: "tool.call",
          sessionID: session.id,
          tool: "read",
          callID: "call-b",
          input: { filePath: "b.ts" },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "read",
          callID: "call-b",
          status: "completed",
          output: "B",
          durationMs: 1,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "read",
          callID: "call-a",
          status: "completed",
          output: "A",
          durationMs: 20,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const report = await AuditReport.generate(session.id)
        const rows = report.split("\n").filter((line) => line.includes(".ts"))
        expect(rows).toHaveLength(2)
        expect(rows[0]).toContain("a.ts")
        expect(rows[1]).toContain("b.ts")
        expect(rows[0]!.startsWith("| 1 |")).toBe(true)
        expect(rows[1]!.startsWith("| 2 |")).toBe(true)
      },
    })
  })

  test("does not infer validation pass or fail from raw bash status", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Audit report bash status" })
        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.call",
          sessionID: session.id,
          tool: "bash",
          callID: "call-test",
          input: { command: "bun test" },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "bash",
          callID: "call-test",
          status: "completed",
          output: "0 passed, 1 failed",
          durationMs: 10,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const report = await AuditReport.generate(session.id)
        expect(report).toContain("| 1 |")
        expect(report).not.toContain("## Validation")
        expect(report).not.toContain("**PASS:** bun test")

        EventQuery.deleteBySession(session.id)
      },
    })
  })

  test("redacts credentials in the action-log target cell", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Audit report target redaction" })
        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.call",
          sessionID: session.id,
          tool: "webfetch",
          callID: "call-fetch",
          input: { url: "https://alice:s3cret@example.com/page" },
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const report = await AuditReport.generate(session.id)
        expect(report).not.toContain("s3cret")
        expect(report).toContain("alice:[redacted]@example.com")

        EventQuery.deleteBySession(session.id)
      },
    })
  })

  test("renders validation from structured verification envelopes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Audit report verification envelopes" })
        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "verify_project",
          callID: "call-verify",
          status: "completed",
          durationMs: 10,
          metadata: {
            verificationEnvelopes: [
              envelope({ sessionID: session.id, name: "typecheck", type: "typecheck", passed: true }),
              envelope({ sessionID: session.id, name: "tests", type: "test", passed: false }),
            ],
          },
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const report = await AuditReport.generate(session.id)
        expect(report).toContain("## Validation")
        expect(report).toContain("- **PASS:** typecheck: typecheck")
        expect(report).toContain("- **FAIL:** tests: tests")

        EventQuery.deleteBySession(session.id)
      },
    })
  })
})
