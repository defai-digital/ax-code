import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { computeFindingId } from "../../src/quality/finding"
import type { Finding } from "../../src/quality/finding"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { SessionFindings } from "../../src/session/findings"
import { tmpdir } from "../fixture/fixture"

function buildFinding(overrides: Partial<Finding> = {}): Finding {
  const base: Omit<Finding, "findingId"> = {
    schemaVersion: 1,
    workflow: "review",
    category: "bug",
    severity: "HIGH",
    summary: "Off-by-one in pagination loop",
    file: "src/server/routes/list.ts",
    anchor: { kind: "line", line: 42 },
    rationale: "Loop runs n+1 times when limit equals total.",
    evidence: ["src/server/routes/list.ts:42 - condition uses <= instead of <"],
    suggestedNextAction: "Change condition to `<` and add a regression test.",
    source: { tool: "review", version: "4.x.x", runId: "ses_test" },
  }
  const merged = { ...base, ...overrides } as Omit<Finding, "findingId">
  const findingId = computeFindingId({
    workflow: merged.workflow,
    category: merged.category,
    file: merged.file,
    anchor: merged.anchor,
    ruleId: merged.ruleId,
  })
  return { ...merged, findingId } as Finding
}

async function emitRegisterFinding(
  sessionID: string,
  callID: string,
  finding: Finding,
  metadataOverrides?: Record<string, unknown>,
) {
  Recorder.emit({
    type: "tool.call",
    sessionID: sessionID as any,
    tool: "register_finding",
    callID,
    input: {
      workflow: finding.workflow,
      category: finding.category,
      severity: finding.severity,
      summary: finding.summary,
      file: finding.file,
      anchor: finding.anchor,
      rationale: finding.rationale,
      evidence: finding.evidence,
      suggestedNextAction: finding.suggestedNextAction,
    },
  })
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "register_finding",
    callID,
    status: "completed",
    output: `Recorded ${finding.severity} ${finding.category} finding`,
    metadata: { findingId: finding.findingId, finding, ...metadataOverrides },
    durationMs: 5,
  })
}

describe("SessionFindings.load", () => {
  test("returns [] for a session with no register_finding calls", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "session.end",
          sessionID: session.id,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(SessionFindings.load(session.id)).toEqual([])
      },
    })
  })

  test("rebuilds Finding[] from register_finding tool.result events", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const f1 = buildFinding({
          source: { tool: "review", version: "4.x.x", runId: session.id },
        })
        const f2 = buildFinding({
          file: "src/auth.ts",
          anchor: { kind: "line", line: 10 },
          severity: "MEDIUM",
          summary: "Missing null guard",
          source: { tool: "review", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        await emitRegisterFinding(session.id, "call-1", f1)
        await emitRegisterFinding(session.id, "call-2", f2)
        Recorder.emit({
          type: "session.end",
          sessionID: session.id,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const findings = SessionFindings.load(session.id)
        expect(findings).toHaveLength(2)
        expect(findings.map((f) => f.findingId)).toEqual([f1.findingId, f2.findingId])
        expect(findings[0].severity).toBe("HIGH")
        expect(findings[1].severity).toBe("MEDIUM")
      },
    })
  })

  test("ignores tool.result events from other tools", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const f1 = buildFinding({
          source: { tool: "review", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        // a non-register_finding tool with a metadata.finding payload
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "security_scan",
          callID: "call-other",
          status: "completed",
          metadata: { finding: f1 },
          durationMs: 1,
        })
        // a real register_finding event
        await emitRegisterFinding(session.id, "call-good", f1)
        Recorder.emit({
          type: "session.end",
          sessionID: session.id,
          reason: "completed",
          totalSteps: 0,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const findings = SessionFindings.load(session.id)
        expect(findings).toHaveLength(1)
        expect(findings[0].findingId).toBe(f1.findingId)
      },
    })
  })

  test("skips tool.result events with malformed metadata.finding", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const good = buildFinding({
          source: { tool: "review", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "register_finding",
          callID: "call-malformed",
          status: "completed",
          metadata: { finding: { severity: "BLOCKER", summary: "x" } },
          durationMs: 1,
        })
        await emitRegisterFinding(session.id, "call-good", good)
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const findings = SessionFindings.load(session.id)
        expect(findings).toHaveLength(1)
        expect(findings[0].findingId).toBe(good.findingId)
      },
    })
  })

  test("dedups by findingId across multiple tool.result emits (keeps first occurrence)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const finding = buildFinding({
          source: { tool: "review", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        // Same finding emitted three times (model re-runs /review)
        await emitRegisterFinding(session.id, "call-1", finding)
        await emitRegisterFinding(session.id, "call-2", finding)
        await emitRegisterFinding(session.id, "call-3", finding)
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const findings = SessionFindings.load(session.id)
        expect(findings).toHaveLength(1)
        expect(findings[0].findingId).toBe(finding.findingId)
      },
    })
  })

  test("ignores register_finding tool.result events with status: 'error'", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const f1 = buildFinding({
          source: { tool: "review", version: "4.x.x", runId: session.id },
        })

        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "register_finding",
          callID: "call-err",
          status: "error",
          metadata: { finding: f1 },
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(SessionFindings.load(session.id)).toEqual([])
      },
    })
  })
})

describe("SessionFindings.countByWorkflow", () => {
  test("returns zero counts for an empty list", () => {
    const counts = SessionFindings.countByWorkflow([])
    expect(counts.review.total).toBe(0)
    expect(counts.debug.total).toBe(0)
    expect(counts.qa.total).toBe(0)
    expect(counts.review.HIGH).toBe(0)
  })

  test("buckets findings by workflow and severity", () => {
    const findings = [
      buildFinding({ severity: "CRITICAL" }),
      buildFinding({ severity: "HIGH", anchor: { kind: "line", line: 50 } }),
      buildFinding({ severity: "HIGH", anchor: { kind: "line", line: 60 } }),
      buildFinding({ severity: "MEDIUM", workflow: "debug", anchor: { kind: "line", line: 70 } }),
      buildFinding({ severity: "INFO", workflow: "qa", anchor: { kind: "line", line: 80 } }),
      buildFinding({ severity: "LOW", workflow: "qa", anchor: { kind: "line", line: 90 } }),
    ]
    const counts = SessionFindings.countByWorkflow(findings)
    expect(counts.review.CRITICAL).toBe(1)
    expect(counts.review.HIGH).toBe(2)
    expect(counts.review.total).toBe(3)
    expect(counts.debug.MEDIUM).toBe(1)
    expect(counts.debug.total).toBe(1)
    expect(counts.qa.INFO).toBe(1)
    expect(counts.qa.LOW).toBe(1)
    expect(counts.qa.total).toBe(2)
  })
})
