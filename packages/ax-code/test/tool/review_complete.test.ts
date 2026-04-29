import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { computeFindingId, type Finding } from "../../src/quality/finding"
import { computeEnvelopeId, type VerificationEnvelope } from "../../src/quality/verification-envelope"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { ReviewCompleteTool } from "../../src/tool/review_complete"
import { tmpdir } from "../fixture/fixture"

function ctx(sessionID: string) {
  return {
    sessionID,
    messageID: "msg_test" as any,
    agent: "build",
    abort: new AbortController().signal,
    callID: "call_review_complete",
    messages: [],
    metadata: () => {},
    ask: async () => {},
  } as any
}

function finding(sessionID: string, overrides: Partial<Finding> = {}): Finding {
  const base: Omit<Finding, "findingId"> = {
    schemaVersion: 1,
    workflow: "review",
    category: "bug",
    severity: "LOW",
    summary: "Minor cleanup",
    file: "src/foo.ts",
    anchor: { kind: "line", line: 3 },
    rationale: "The review should preserve non-blocking findings.",
    evidence: ["src/foo.ts:3"],
    suggestedNextAction: "Clean this up before the next release.",
    source: { tool: "review", version: "4.x.x", runId: sessionID },
  }
  const merged = { ...base, ...overrides } as Omit<Finding, "findingId">
  return {
    ...merged,
    findingId: computeFindingId({
      workflow: merged.workflow,
      category: merged.category,
      file: merged.file,
      anchor: merged.anchor,
      ruleId: merged.ruleId,
    }),
  } as Finding
}

function envelope(sessionID: string, status: "passed" | "failed" | "skipped" = "passed"): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "review",
    scope: { kind: "workspace" },
    command: { runner: "typecheck", argv: ["sh", "-c", "bun run typecheck"], cwd: "/tmp/work" },
    result: {
      name: "typecheck",
      type: "typecheck",
      passed: status === "passed",
      status,
      issues: [],
      duration: 10,
    },
    structuredFailures: [],
    artifactRefs: [],
    source: { tool: "verify_project", version: "4.x.x", runId: sessionID },
  }
}

function emitFinding(sessionID: string, item: Finding) {
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "register_finding",
    callID: `call-finding-${item.findingId}`,
    status: "completed",
    output: "registered",
    metadata: { findingId: item.findingId, finding: item },
    durationMs: 1,
  })
}

function emitEnvelope(sessionID: string, item: VerificationEnvelope) {
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "verify_project",
    callID: "call-verify",
    status: "completed",
    output: "verified",
    metadata: { verificationEnvelopes: [item] },
    durationMs: 1,
  })
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("ReviewCompleteTool", () => {
  test("approves when review findings are non-blocking and verification passed", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const low = finding(session.id)
        const passed = envelope(session.id)

        Recorder.begin(session.id)
        emitFinding(session.id, low)
        emitEnvelope(session.id, passed)
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const tool = await ReviewCompleteTool.init()
        const result = await tool.execute({ summary: "Review passed with one non-blocking cleanup." }, ctx(session.id))

        expect(result.title).toBe("review_complete approve")
        expect(result.metadata.reviewResult).toMatchObject({
          decision: "approve",
          recommendedDecision: "approve",
          findingIds: [low.findingId],
          verificationEnvelopeIds: [computeEnvelopeId(passed)],
          missingVerification: false,
        })
        expect(result.output).toContain(result.metadata.reviewId)
      },
    })
  })

  test("blocks approve when HIGH or CRITICAL findings exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const high = finding(session.id, {
          severity: "HIGH",
          summary: "Unsafe pagination logic",
        })
        const passed = envelope(session.id)

        Recorder.begin(session.id)
        emitFinding(session.id, high)
        emitEnvelope(session.id, passed)
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const tool = await ReviewCompleteTool.init()
        await expect(
          tool.execute({ summary: "Should not approve.", decision: "approve" }, ctx(session.id)),
        ).rejects.toThrow(/Cannot approve review with blocking findings/)

        const result = await tool.execute({ summary: "Needs changes." }, ctx(session.id))
        expect(result.metadata.reviewResult.decision).toBe("request_changes")
        expect(result.metadata.reviewResult.blockingFindingIds).toEqual([high.findingId])
      },
    })
  })

  test("recommends needs_verification when there is no passed verification envelope", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const low = finding(session.id)

        Recorder.begin(session.id)
        emitFinding(session.id, low)
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const tool = await ReviewCompleteTool.init()
        const result = await tool.execute({ summary: "Review still needs verification." }, ctx(session.id))
        expect(result.metadata.reviewResult.decision).toBe("needs_verification")
        expect(result.metadata.reviewResult.missingVerification).toBe(true)
        await expect(
          tool.execute({ summary: "Should not approve.", decision: "approve" }, ctx(session.id)),
        ).rejects.toThrow(/without at least one passed verification/)
      },
    })
  })

  test("rejects fabricated finding and verification ids", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tool = await ReviewCompleteTool.init()
        await expect(
          tool.execute({ summary: "Bad refs.", findingIds: ["0000000000000000"] }, ctx(session.id)),
        ).rejects.toThrow(/unknown review finding id/)
        await expect(
          tool.execute({ summary: "Bad refs.", verificationEnvelopeIds: ["0000000000000000"] }, ctx(session.id)),
        ).rejects.toThrow(/unknown verification envelope id/)
      },
    })
  })
})
