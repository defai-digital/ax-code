import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { DebugProposeHypothesisTool } from "../../src/tool/debug_propose_hypothesis"
import {
  computeDebugCaseId,
  computeDebugEvidenceId,
  DebugHypothesisSchema,
  DEBUG_ID_PATTERN,
} from "../../src/debug-engine/runtime-debug"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"
import { Installation } from "../../src/installation"
import { computeEnvelopeId } from "../../src/quality/verification-envelope"
import type { SessionID } from "../../src/session/schema"
import type { VerificationEnvelope } from "../../src/quality/verification-envelope"

function fakeCtx(sessionID: string) {
  return {
    sessionID,
    messageID: "" as any,
    agent: "build",
    abort: new AbortController().signal,
    callID: "test",
    messages: [],
    metadata() {},
    ask: async () => {},
  } as any
}

async function emitCaseAndEvidence(sessionID: SessionID, directory: string, problem: string, evidenceContent: string) {
  const caseId = computeDebugCaseId({ problem, runId: sessionID })
  const evidenceId = computeDebugEvidenceId({ caseId, kind: "log_capture", content: evidenceContent })
  Recorder.begin(sessionID)
  Recorder.emit({
    type: "session.start",
    sessionID: sessionID as any,
    agent: "build",
    model: "test/model",
    directory,
  })
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "debug_open_case",
    callID: "call-open",
    status: "completed",
    metadata: {
      caseId,
      debugCase: {
        schemaVersion: 1,
        caseId,
        problem,
        status: "open",
        createdAt: new Date().toISOString(),
        source: { tool: "debug_open_case", version: Installation.VERSION, runId: sessionID },
      },
    },
    durationMs: 1,
  })
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "debug_capture_evidence",
    callID: "call-evidence",
    status: "completed",
    metadata: {
      evidenceId,
      debugEvidence: {
        schemaVersion: 1,
        evidenceId,
        caseId,
        kind: "log_capture",
        capturedAt: new Date().toISOString(),
        content: evidenceContent,
        source: { tool: "debug_capture_evidence", version: Installation.VERSION, runId: sessionID },
      },
    },
    durationMs: 1,
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  return { caseId, evidenceId }
}

describe("DebugProposeHypothesisTool", () => {
  test("rejects unknown caseId", async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 30))

        const tool = await DebugProposeHypothesisTool.init()
        await expect(
          tool.execute({ caseId: "0000aaaa1111bbbb", claim: "It is X" } as any, fakeCtx(session.id)),
        ).rejects.toThrow(/unknown debug case/)
      },
    })
  })

  test("rejects unknown evidenceRefs id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { caseId } = await emitCaseAndEvidence(session.id, tmp.path, "p", "log content")

        const tool = await DebugProposeHypothesisTool.init()
        await expect(
          tool.execute({ caseId, claim: "It is X", evidenceRefs: ["2222cccc3333dddd"] } as any, fakeCtx(session.id)),
        ).rejects.toThrow(/unknown id/)
      },
    })
  })

  test("happy path produces a schema-valid hypothesis with confidence in [0, 0.95]", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { caseId, evidenceId } = await emitCaseAndEvidence(session.id, tmp.path, "p", "log content")

        const tool = await DebugProposeHypothesisTool.init()
        const result = await tool.execute(
          {
            caseId,
            claim: "Connection pool exhaustion under CI concurrency",
            evidenceRefs: [evidenceId],
            staticAnalysis: { sourceCallId: "call_debug_analyze_1", chainLength: 5, chainConfidence: 0.6 },
          },
          fakeCtx(session.id),
        )

        expect(result.metadata.hypothesisId).toMatch(DEBUG_ID_PATTERN)
        const parsed = DebugHypothesisSchema.parse(result.metadata.debugHypothesis)
        expect(parsed.confidence).toBeGreaterThan(0.4)
        expect(parsed.confidence).toBeLessThanOrEqual(0.95)
        expect(parsed.staticAnalysis?.chainLength).toBe(5)
        expect(parsed.evidenceRefs).toContain(evidenceId)
        expect(parsed.status).toBe("active")
      },
    })
  })

  test("confidence climbs with more evidence (capped at 0.95)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { caseId } = await emitCaseAndEvidence(session.id, tmp.path, "p", "x")

        const tool = await DebugProposeHypothesisTool.init()
        const noEvidence = await tool.execute({ caseId, claim: "claim a" }, fakeCtx(session.id))
        const withStatic = await tool.execute(
          {
            caseId,
            claim: "claim b",
            staticAnalysis: { sourceCallId: "call_x", chainLength: 5, chainConfidence: 0.95 },
          },
          fakeCtx(session.id),
        )

        expect(noEvidence.metadata.confidence).toBeLessThan(withStatic.metadata.confidence)
        expect(withStatic.metadata.confidence).toBeLessThanOrEqual(0.95)
      },
    })
  })

  test("status defaults to 'active'", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { caseId } = await emitCaseAndEvidence(session.id, tmp.path, "p", "x")

        const tool = await DebugProposeHypothesisTool.init()
        const result = await tool.execute({ caseId, claim: "x" }, fakeCtx(session.id))
        expect(result.metadata.debugHypothesis.status).toBe("active")
      },
    })
  })

  test("evidenceRefs accepts VerificationEnvelope ids in addition to DebugEvidence ids (verify-after-fix loop)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { caseId } = await emitCaseAndEvidence(session.id, tmp.path, "p", "log content")

        // Emit a VerificationEnvelope into the session — same shape that
        // refactor_apply produces. applyVerificationToHypothesis would
        // append this envelope id to evidenceRefs; the tool must accept it.
        const envelope: VerificationEnvelope = {
          schemaVersion: 1,
          workflow: "qa",
          scope: { kind: "file", paths: ["src/foo.ts"] },
          command: { runner: "typecheck", argv: [], cwd: "/tmp" },
          result: {
            name: "typecheck",
            type: "typecheck",
            passed: true,
            status: "passed",
            issues: [],
            duration: 0,
          },
          structuredFailures: [],
          artifactRefs: [],
          source: { tool: "refactor_apply", version: "4.x.x", runId: session.id },
        }
        const envelopeId = computeEnvelopeId(envelope)
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id as any,
          tool: "refactor_apply",
          callID: "call-apply",
          status: "completed",
          metadata: { verificationEnvelopes: [envelope] },
          durationMs: 1,
        })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const tool = await DebugProposeHypothesisTool.init()
        const result = await tool.execute(
          {
            caseId,
            claim: "fix verified by typecheck",
            evidenceRefs: [envelopeId],
          },
          fakeCtx(session.id),
        )
        expect(result.metadata.debugHypothesis.evidenceRefs).toContain(envelopeId)
      },
    })
  })

  test("status confirmed requires a passed VerificationEnvelope evidenceRef", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { caseId, evidenceId } = await emitCaseAndEvidence(session.id, tmp.path, "p", "log content")

        const failedEnvelope: VerificationEnvelope = {
          schemaVersion: 1,
          workflow: "qa",
          scope: { kind: "file", paths: ["src/foo.ts"] },
          command: { runner: "typecheck", argv: [], cwd: "/tmp" },
          result: {
            name: "typecheck",
            type: "typecheck",
            passed: false,
            status: "failed",
            issues: [],
            duration: 0,
          },
          structuredFailures: [],
          artifactRefs: [],
          source: { tool: "verify_project", version: "4.x.x", runId: session.id },
        }
        const passedEnvelope: VerificationEnvelope = {
          ...failedEnvelope,
          result: {
            ...failedEnvelope.result,
            passed: true,
            status: "passed",
          },
        }
        const failedEnvelopeId = computeEnvelopeId(failedEnvelope)
        const passedEnvelopeId = computeEnvelopeId(passedEnvelope)
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id as any,
          tool: "verify_project",
          callID: "call-verify",
          status: "completed",
          metadata: { verificationEnvelopes: [failedEnvelope, passedEnvelope] },
          durationMs: 1,
        })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const tool = await DebugProposeHypothesisTool.init()
        await expect(
          tool.execute(
            {
              caseId,
              claim: "log evidence alone should not confirm",
              evidenceRefs: [evidenceId],
              status: "confirmed",
            },
            fakeCtx(session.id),
          ),
        ).rejects.toThrow(/without a successful VerificationEnvelope evidence set/)
        await expect(
          tool.execute(
            {
              caseId,
              claim: "failed verification should not confirm",
              evidenceRefs: [failedEnvelopeId],
              status: "confirmed",
            },
            fakeCtx(session.id),
          ),
        ).rejects.toThrow(/without a successful VerificationEnvelope evidence set/)

        await expect(
          tool.execute(
            {
              caseId,
              claim: "mixed verification should not confirm",
              evidenceRefs: [failedEnvelopeId, passedEnvelopeId],
              status: "confirmed",
            },
            fakeCtx(session.id),
          ),
        ).rejects.toThrow(/without a successful VerificationEnvelope evidence set/)

        const result = await tool.execute(
          {
            caseId,
            claim: "passed verification confirms the fix",
            evidenceRefs: [passedEnvelopeId],
            status: "confirmed",
          },
          fakeCtx(session.id),
        )
        expect(result.metadata.debugHypothesis.status).toBe("confirmed")
        expect(result.metadata.debugHypothesis.evidenceRefs).toContain(passedEnvelopeId)
      },
    })
  })

  test("rejects evidenceRefs id that exists in neither DebugEvidence nor VerificationEnvelope", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { caseId } = await emitCaseAndEvidence(session.id, tmp.path, "p", "log content")

        const tool = await DebugProposeHypothesisTool.init()
        await expect(
          tool.execute({ caseId, claim: "fabricated", evidenceRefs: ["00ffffffffffffff"] } as any, fakeCtx(session.id)),
        ).rejects.toThrow(/unknown id/)
      },
    })
  })

  test("same case + claim deduplicates to the same hypothesisId across calls", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { caseId } = await emitCaseAndEvidence(session.id, tmp.path, "p", "x")

        const tool = await DebugProposeHypothesisTool.init()
        const a = await tool.execute({ caseId, claim: "the cache is wrong" }, fakeCtx(session.id))
        const b = await tool.execute({ caseId, claim: "the cache is wrong" }, fakeCtx(session.id))
        expect(a.metadata.hypothesisId).toBe(b.metadata.hypothesisId)
      },
    })
  })
})
