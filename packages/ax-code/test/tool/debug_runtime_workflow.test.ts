import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Session } from "../../src/session"
import { SessionDebug } from "../../src/session/debug"
import { SessionVerifications } from "../../src/session/verifications"
import { DebugApplyVerificationTool } from "../../src/tool/debug_apply_verification"
import { DebugCaptureEvidenceTool } from "../../src/tool/debug_capture_evidence"
import { DebugOpenCaseTool } from "../../src/tool/debug_open_case"
import { DebugPlanInstrumentationTool } from "../../src/tool/debug_plan_instrumentation"
import { DebugProposeHypothesisTool } from "../../src/tool/debug_propose_hypothesis"
import { VerifyProjectTool } from "../../src/tool/verify_project"
import { tmpdir } from "../fixture/fixture"

function ctx(sessionID: string, asks: any[] = []) {
  return {
    sessionID,
    messageID: "msg_runtime_debug" as any,
    agent: "build",
    abort: new AbortController().signal,
    callID: "call_runtime_debug",
    messages: [],
    metadata() {},
    ask: async (input: any) => {
      asks.push(input)
    },
  } as any
}

async function waitForRecorder() {
  await new Promise((resolve) => setTimeout(resolve, 30))
}

async function recordToolResult(input: {
  sessionID: string
  tool: string
  callID: string
  result: { output?: string; metadata?: Record<string, unknown> }
}) {
  Recorder.emit({
    type: "tool.result",
    sessionID: input.sessionID as any,
    tool: input.tool,
    callID: input.callID,
    status: "completed",
    output: input.result.output,
    metadata: input.result.metadata,
    durationMs: 1,
  })
  await waitForRecorder()
}

describe("runtime debug workflow", () => {
  test("persists case -> instrumentation -> evidence -> hypothesis -> debug verification as one resolvable path", async () => {
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

        try {
          const openCase = await (
            await DebugOpenCaseTool.init()
          ).execute({ problem: "worker pool requests time out under CI load" }, ctx(session.id))
          await recordToolResult({
            sessionID: session.id,
            tool: "debug_open_case",
            callID: "call-open",
            result: openCase,
          })
          const caseId = openCase.metadata.caseId as string

          const targets = [
            {
              file: "src/worker-pool.ts",
              anchor: { symbol: "acquireWorker" },
              probe: "Log queue depth and active worker count before waiting for a slot",
              removeInstruction: "Remove the temporary queue-depth log after evidence is captured",
            },
          ]
          const instrumentation = await DebugPlanInstrumentationTool.init()
          const planInput = {
            caseId,
            purpose: "confirm whether queue depth spikes before request timeout",
            targets,
          }
          const planned = await instrumentation.execute(planInput, ctx(session.id))
          await recordToolResult({
            sessionID: session.id,
            tool: "debug_plan_instrumentation",
            callID: "call-plan",
            result: planned,
          })
          const applied = await instrumentation.execute({ ...planInput, status: "applied" }, ctx(session.id))
          await recordToolResult({
            sessionID: session.id,
            tool: "debug_plan_instrumentation",
            callID: "call-plan-applied",
            result: applied,
          })

          const captured = await (
            await DebugCaptureEvidenceTool.init()
          ).execute(
            {
              caseId,
              kind: "instrumentation_result",
              content: "queueDepth=14 activeWorkers=4 timeoutMs=30000",
            },
            ctx(session.id),
          )
          await recordToolResult({
            sessionID: session.id,
            tool: "debug_capture_evidence",
            callID: "call-evidence",
            result: captured,
          })
          const evidenceId = captured.metadata.evidenceId as string

          const removed = await instrumentation.execute({ ...planInput, status: "removed" }, ctx(session.id))
          await recordToolResult({
            sessionID: session.id,
            tool: "debug_plan_instrumentation",
            callID: "call-plan-removed",
            result: removed,
          })
          Recorder.emit({
            type: "tool.result",
            sessionID: session.id as any,
            tool: "debug_analyze",
            callID: "call-debug-analyze",
            status: "completed",
            metadata: {
              chainLength: 3,
              confidence: 0.62,
              resolvedCount: 2,
              truncated: false,
            },
            durationMs: 1,
          })
          await waitForRecorder()

          const hypothesis = await (
            await DebugProposeHypothesisTool.init()
          ).execute(
            {
              caseId,
              claim: "worker pool starvation is causing CI request timeouts",
              evidenceRefs: [evidenceId],
              staticAnalysis: {
                sourceCallId: "call-debug-analyze",
                chainLength: 3,
                chainConfidence: 0.62,
              },
            },
            ctx(session.id),
          )
          await recordToolResult({
            sessionID: session.id,
            tool: "debug_propose_hypothesis",
            callID: "call-hypothesis",
            result: hypothesis,
          })
          const hypothesisId = hypothesis.metadata.hypothesisId as string

          const asks: any[] = []
          const verify = await (
            await VerifyProjectTool.init()
          ).execute(
            {
              workflow: "debug",
              paths: ["src/worker-pool.ts"],
              commands: {
                typecheck: `bun -e "process.exit(0)"`,
                lint: null,
                test: null,
              },
            },
            ctx(session.id, asks),
          )
          await recordToolResult({
            sessionID: session.id,
            tool: "verify_project",
            callID: "call-verify-debug",
            result: verify,
          })
          expect(asks).toHaveLength(1)
          const selectedEnvelope = (verify.metadata.envelopeIds as Array<{ envelopeId: string; status: string }>).find(
            (item) => item.status === "passed",
          )
          if (!selectedEnvelope) throw new Error("missing passed verification envelope")

          const appliedVerification = await (
            await DebugApplyVerificationTool.init()
          ).execute({ hypothesisId, envelopeId: selectedEnvelope.envelopeId }, ctx(session.id))
          await recordToolResult({
            sessionID: session.id,
            tool: "debug_apply_verification",
            callID: "call-apply-verification",
            result: appliedVerification,
          })

          const debug = SessionDebug.load(session.id)
          expect(debug.cases).toHaveLength(1)
          expect(debug.evidence).toHaveLength(1)
          expect(debug.instrumentationPlans).toHaveLength(1)
          expect(debug.instrumentationPlans[0]).toMatchObject({
            planId: planned.metadata.planId,
            status: "removed",
          })
          expect(debug.hypotheses).toHaveLength(1)
          expect(debug.hypotheses[0]).toMatchObject({
            hypothesisId,
            status: "confirmed",
          })
          expect(debug.hypotheses[0].evidenceRefs).toContain(evidenceId)
          expect(debug.hypotheses[0].evidenceRefs).toContain(selectedEnvelope.envelopeId)
          expect(SessionDebug.rollup(debug)[0]).toMatchObject({
            caseId,
            effectiveStatus: "resolved",
          })

          const verificationRuns = SessionVerifications.loadRunsWithIds(session.id)
          expect(verificationRuns).toHaveLength(1)
          expect(verificationRuns[0].envelopes.map((item) => item.envelope.workflow)).toEqual([
            "debug",
            "debug",
            "debug",
          ])
          expect(appliedVerification.metadata.verificationOutcome).toBe("confirmed")
        } finally {
          Recorder.end(session.id)
          await waitForRecorder()
          EventQuery.deleteBySession(session.id)
        }
      },
    })
  })
})
