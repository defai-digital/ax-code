import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import {
  computeDebugCaseId,
  computeDebugEvidenceId,
  computeDebugHypothesisId,
  DebugHypothesisSchema,
} from "../../src/debug-engine/runtime-debug"
import { Installation } from "../../src/installation"
import { computeEnvelopeId, type VerificationEnvelope } from "../../src/quality/verification-envelope"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { SessionDebug } from "../../src/session/debug"
import type { SessionID } from "../../src/session/schema"
import { DebugApplyVerificationTool } from "../../src/tool/debug_apply_verification"
import { tmpdir } from "../fixture/fixture"

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

async function waitForRecorder() {
  await new Promise((resolve) => setTimeout(resolve, 30))
}

async function emitDebugHypothesis(sessionID: SessionID, directory: string) {
  const problem = "tests fail after fixing worker pool"
  const caseId = computeDebugCaseId({ problem, runId: sessionID })
  const evidenceContent = "[INFO] worker pool timeout"
  const evidenceId = computeDebugEvidenceId({ caseId, kind: "log_capture", content: evidenceContent })
  const claim = "worker pool starvation caused the failure"
  const hypothesisId = computeDebugHypothesisId({ caseId, claim })

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
        createdAt: "2026-04-26T18:00:00.000Z",
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
        capturedAt: "2026-04-26T18:01:00.000Z",
        content: evidenceContent,
        source: { tool: "debug_capture_evidence", version: Installation.VERSION, runId: sessionID },
      },
    },
    durationMs: 1,
  })
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "debug_propose_hypothesis",
    callID: "call-hypothesis",
    status: "completed",
    metadata: {
      hypothesisId,
      debugHypothesis: {
        schemaVersion: 1,
        hypothesisId,
        caseId,
        claim,
        confidence: 0.65,
        evidenceRefs: [evidenceId],
        status: "active",
        source: { tool: "debug_propose_hypothesis", version: Installation.VERSION, runId: sessionID },
      },
    },
    durationMs: 1,
  })
  await waitForRecorder()
  return { caseId, evidenceId, hypothesisId }
}

function verificationEnvelope(
  sessionID: SessionID,
  status: "passed" | "failed" | "error",
  structuredFailures: VerificationEnvelope["structuredFailures"] = [],
): VerificationEnvelope {
  return {
    schemaVersion: 1,
    workflow: "debug",
    scope: { kind: "file", paths: ["src/foo.ts"] },
    command: { runner: "test", argv: ["bun", "test", "test/foo.test.ts"], cwd: "/tmp/project" },
    result: {
      name: "focused tests",
      type: "test",
      passed: status === "passed",
      status,
      issues: [],
      duration: 12,
    },
    structuredFailures,
    artifactRefs: [],
    source: { tool: "verify_project", version: Installation.VERSION, runId: sessionID },
  }
}

async function emitVerification(sessionID: SessionID, envelope: VerificationEnvelope) {
  const envelopeId = computeEnvelopeId(envelope)
  Recorder.emit({
    type: "tool.result",
    sessionID: sessionID as any,
    tool: "verify_project",
    callID: `call-verify-${envelopeId}`,
    status: "completed",
    metadata: { verificationEnvelopes: [envelope] },
    durationMs: 1,
  })
  await waitForRecorder()
  return envelopeId
}

describe("DebugApplyVerificationTool", () => {
  test("rejects unknown hypothesisId", async () => {
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
        await waitForRecorder()

        const tool = await DebugApplyVerificationTool.init()
        await expect(
          tool.execute(
            { hypothesisId: "0000aaaa1111bbbb", envelopeId: "2222cccc3333dddd" },
            fakeCtx(session.id),
          ),
        ).rejects.toThrow(/unknown debug hypothesis/)
      },
    })
  })

  test("rejects unknown envelopeId", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { hypothesisId } = await emitDebugHypothesis(session.id, tmp.path)

        const tool = await DebugApplyVerificationTool.init()
        await expect(
          tool.execute({ hypothesisId, envelopeId: "2222cccc3333dddd" }, fakeCtx(session.id)),
        ).rejects.toThrow(/unknown VerificationEnvelope/)
      },
    })
  })

  test("passed verification confirms the hypothesis and appends the envelope ref", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { hypothesisId } = await emitDebugHypothesis(session.id, tmp.path)
        const envelopeId = await emitVerification(session.id, verificationEnvelope(session.id, "passed"))

        const tool = await DebugApplyVerificationTool.init()
        const result = await tool.execute({ hypothesisId, envelopeId }, fakeCtx(session.id))

        const parsed = DebugHypothesisSchema.parse(result.metadata.debugHypothesis)
        expect(result.metadata.verificationOutcome).toBe("confirmed")
        expect(result.metadata.effectiveCaseStatus).toBe("resolved")
        expect(parsed.status).toBe("confirmed")
        expect(parsed.evidenceRefs).toContain(envelopeId)
        expect(parsed.source.tool).toBe("debug_apply_verification")

        Recorder.emit({
          type: "tool.result",
          sessionID: session.id as any,
          tool: "debug_apply_verification",
          callID: "call-apply-verification",
          status: "completed",
          metadata: result.metadata,
          durationMs: 1,
        })
        await waitForRecorder()
        expect(SessionDebug.load(session.id).hypotheses[0].status).toBe("confirmed")
      },
    })
  })

  test("failed verification with structured failures refutes the hypothesis", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { hypothesisId } = await emitDebugHypothesis(session.id, tmp.path)
        const envelopeId = await emitVerification(
          session.id,
          verificationEnvelope(session.id, "failed", [
            {
              kind: "test",
              testName: "worker pool recovers",
              framework: "bun",
              file: "test/worker.test.ts",
            },
          ]),
        )

        const tool = await DebugApplyVerificationTool.init()
        const result = await tool.execute({ hypothesisId, envelopeId }, fakeCtx(session.id))

        expect(result.metadata.verificationOutcome).toBe("refuted")
        expect(result.metadata.effectiveCaseStatus).toBe("unresolved")
        expect(result.metadata.debugHypothesis.status).toBe("refuted")
        expect(result.metadata.debugHypothesis.evidenceRefs).toContain(envelopeId)
      },
    })
  })

  test("inconclusive verification keeps the hypothesis active without appending the envelope ref", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const { hypothesisId } = await emitDebugHypothesis(session.id, tmp.path)
        const envelopeId = await emitVerification(session.id, verificationEnvelope(session.id, "error"))

        const tool = await DebugApplyVerificationTool.init()
        const result = await tool.execute({ hypothesisId, envelopeId }, fakeCtx(session.id))

        expect(result.metadata.verificationOutcome).toBe("inconclusive")
        expect(result.metadata.effectiveCaseStatus).toBe("investigating")
        expect(result.metadata.debugHypothesis.status).toBe("active")
        expect(result.metadata.debugHypothesis.evidenceRefs).not.toContain(envelopeId)
      },
    })
  })
})
