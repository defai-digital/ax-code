import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
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

function envelope(
  sessionID: string,
  status: "passed" | "failed" | "skipped" = "passed",
  workflow: VerificationEnvelope["workflow"] = "review",
): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow,
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
    callID: `call-verify-${computeEnvelopeId(item)}`,
    status: "completed",
    output: "verified",
    metadata: { verificationEnvelopes: [item] },
    durationMs: 1,
  })
}

function emitEnvelopeRun(sessionID: string, items: VerificationEnvelope[], metadata: Record<string, unknown> = {}) {
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "verify_project",
    callID: `call-verify-${items.map((item) => computeEnvelopeId(item)).join("-")}`,
    status: "completed",
    output: "verified",
    metadata: { ...metadata, verificationEnvelopes: items },
    durationMs: 1,
  })
}

afterEach(async () => {
  await Instance.disposeAll()
})

async function writeFile(dir: string, relPath: string, contents: string) {
  const full = path.join(dir, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, contents, "utf8")
}

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

  test("applies review policy filtering before recommending the decision", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify({ scope_glob: ["src/**"] }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const inScope = finding(session.id, {
          severity: "LOW",
          file: "src/foo.ts",
          summary: "Minor in-scope cleanup",
        })
        const outOfScopeHigh = finding(session.id, {
          severity: "HIGH",
          file: "docs/readme.md",
          summary: "Docs issue outside review scope",
        })
        const passed = envelope(session.id)

        Recorder.begin(session.id)
        emitFinding(session.id, inScope)
        emitFinding(session.id, outOfScopeHigh)
        emitEnvelope(session.id, passed)
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const tool = await ReviewCompleteTool.init()
        const result = await tool.execute(
          { summary: "Review passed after applying project policy scope." },
          ctx(session.id),
        )

        expect(result.title).toBe("review_complete approve")
        expect(result.metadata.reviewResult).toMatchObject({
          decision: "approve",
          recommendedDecision: "approve",
          findingIds: [inScope.findingId],
          blockingFindingIds: [],
        })
        expect(result.metadata.policy).toMatchObject({
          keptFindingIds: [inScope.findingId],
          droppedFindings: [
            {
              findingId: outOfScopeHigh.findingId,
              reasons: expect.arrayContaining([expect.stringContaining("not matched by scope_glob")]),
            },
          ],
        })
        expect(result.output).toContain("Policy findings: 1 kept, 1 dropped")
      },
    })
  })

  test("surfaces review policy warnings without blocking completion", async () => {
    await using tmp = await tmpdir({ git: true })
    await writeFile(tmp.path, ".ax-code/review.rules.json", JSON.stringify({ required_categories: ["security"] }))

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
        const result = await tool.execute({ summary: "Review complete with a policy warning." }, ctx(session.id))

        expect(result.metadata.reviewResult.decision).toBe("approve")
        expect(result.metadata.policy).toBeDefined()
        if (!result.metadata.policy) throw new Error("missing policy metadata")
        expect(result.metadata.policy.warnings).toEqual(["required_categories missing from kept findings: security"])
        expect(result.output).toContain("Policy warning: required_categories missing from kept findings: security")
      },
    })
  })

  test("does not approve when a selected verification run failed required check policy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const low = finding(session.id)
        const typecheckPassed = envelope(session.id, "passed")
        const testSkipped: VerificationEnvelope = {
          ...envelope(session.id, "skipped"),
          command: { runner: "test", argv: [], cwd: "/tmp/work" },
          result: {
            ...typecheckPassed.result,
            name: "tests",
            type: "test",
            passed: false,
            status: "skipped",
          },
        }

        Recorder.begin(session.id)
        emitFinding(session.id, low)
        emitEnvelopeRun(session.id, [typecheckPassed, testSkipped], {
          policy: {
            rules: { required_checks: ["test"] },
            requiredChecksPassed: false,
            missingRequiredChecks: ["test"],
          },
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const tool = await ReviewCompleteTool.init()
        const result = await tool.execute(
          {
            summary: "Review still needs required verification.",
            verificationEnvelopeIds: [computeEnvelopeId(typecheckPassed)],
          },
          ctx(session.id),
        )

        expect(result.title).toBe("review_complete needs_verification")
        expect(result.metadata.reviewResult).toMatchObject({
          decision: "needs_verification",
          recommendedDecision: "needs_verification",
          verificationEnvelopeIds: [computeEnvelopeId(typecheckPassed)],
          missingVerification: true,
        })
        expect(result.metadata.verificationPolicyFailed).toBe(true)
        expect(result.output).toContain("Verification policy: failed")
        await expect(
          tool.execute(
            {
              summary: "Should not approve with a policy-failed verification run.",
              decision: "approve",
              verificationEnvelopeIds: [computeEnvelopeId(typecheckPassed)],
            },
            ctx(session.id),
          ),
        ).rejects.toThrow(/without a successful verification set/)
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
        expect(result.output).toContain('Next: run verify_project with workflow: "review"')
        await expect(
          tool.execute({ summary: "Should not approve.", decision: "approve" }, ctx(session.id)),
        ).rejects.toThrow(/without a successful verification set/)
      },
    })
  })

  test("does not approve when selected verification has both passed and failed envelopes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const low = finding(session.id)
        const passed = envelope(session.id, "passed")
        const failed = envelope(session.id, "failed")

        Recorder.begin(session.id)
        emitFinding(session.id, low)
        emitEnvelope(session.id, passed)
        emitEnvelope(session.id, failed)
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const tool = await ReviewCompleteTool.init()
        const result = await tool.execute({ summary: "Review still needs a clean verification set." }, ctx(session.id))

        expect(result.title).toBe("review_complete needs_verification")
        expect(result.metadata.reviewResult).toMatchObject({
          decision: "needs_verification",
          recommendedDecision: "needs_verification",
          missingVerification: true,
        })
        expect(result.output).toContain("verification not fully passing")
        expect(result.output).toContain('Next: run verify_project with workflow: "review"')
        await expect(
          tool.execute({ summary: "Should not approve.", decision: "approve" }, ctx(session.id)),
        ).rejects.toThrow(/without a successful verification set/)
      },
    })
  })

  test("does not use non-review verification envelopes as review approval evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const low = finding(session.id)
        const qaPassed = envelope(session.id, "passed", "qa")

        Recorder.begin(session.id)
        emitFinding(session.id, low)
        emitEnvelope(session.id, qaPassed)
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const tool = await ReviewCompleteTool.init()
        const result = await tool.execute(
          { summary: "Review still needs review-scoped verification." },
          ctx(session.id),
        )

        expect(result.metadata.reviewResult).toMatchObject({
          decision: "needs_verification",
          verificationEnvelopeIds: [],
          missingVerification: true,
        })
        expect(result.output).toContain('Next: run verify_project with workflow: "review"')
        await expect(
          tool.execute(
            {
              summary: "Should not cite QA evidence.",
              verificationEnvelopeIds: [computeEnvelopeId(qaPassed)],
            },
            ctx(session.id),
          ),
        ).rejects.toThrow(/only accepts review workflow envelopes/)
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
