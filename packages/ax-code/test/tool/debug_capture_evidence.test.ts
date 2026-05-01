import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { DebugCaptureEvidenceTool } from "../../src/tool/debug_capture_evidence"
import { DebugPlanInstrumentationTool } from "../../src/tool/debug_plan_instrumentation"
import {
  computeDebugCaseId,
  DebugEvidenceSchema,
  DEBUG_ID_PATTERN,
} from "../../src/debug-engine/runtime-debug"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { SessionDebug } from "../../src/session/debug"
import { tmpdir } from "../fixture/fixture"
import { Installation } from "../../src/installation"
import type { SessionID } from "../../src/session/schema"
import { emitOpenedCase, fakeCtx } from "./debug-fixture"

describe("DebugCaptureEvidenceTool", () => {
  test("rejects unknown caseId (no fabricated ids)", async () => {
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

        const tool = await DebugCaptureEvidenceTool.init()
        await expect(
          tool.execute(
            { caseId: "0000aaaa1111bbbb", kind: "log_capture", content: "stuff" } as any,
            fakeCtx(session.id),
          ),
        ).rejects.toThrow(/unknown debug case/)
      },
    })
  })

  test("captures evidence under an opened case and parses against DebugEvidenceSchema", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "tests time out")

        const tool = await DebugCaptureEvidenceTool.init()
        const result = await tool.execute(
          { caseId, kind: "log_capture", content: "[INFO] worker pool: timeout waiting for slot" },
          fakeCtx(session.id),
        )

        expect(result.metadata.evidenceId).toMatch(DEBUG_ID_PATTERN)
        const parsed = DebugEvidenceSchema.parse(result.metadata.debugEvidence)
        expect(parsed.kind).toBe("log_capture")
        expect(parsed.caseId).toBe(caseId)
        expect(parsed.source.tool).toBe("debug_capture_evidence")
        expect(parsed.source.runId).toBe(session.id)
      },
    })
  })

  test("same case + kind + content produces the same evidenceId (deterministic dedup)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "tests time out")

        const tool = await DebugCaptureEvidenceTool.init()
        const a = await tool.execute({ caseId, kind: "stack_trace", content: "Error: boom\n  at foo:1" }, fakeCtx(session.id))
        const b = await tool.execute({ caseId, kind: "stack_trace", content: "Error: boom\n  at foo:1" }, fakeCtx(session.id))
        expect(a.metadata.evidenceId).toBe(b.metadata.evidenceId)
      },
    })
  })

  test("rejects unknown kind (Zod input)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "tests time out")

        const tool = await DebugCaptureEvidenceTool.init()
        await expect(tool.execute({ caseId, kind: "screenshot", content: "x" } as any, fakeCtx(session.id))).rejects.toThrow()
      },
    })
  })

  test("rejects fabricated planId (planId not in session)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "tests time out")

        const tool = await DebugCaptureEvidenceTool.init()
        await expect(
          tool.execute({ caseId, kind: "instrumentation_result", content: "count=3", planId: "0000aaaa1111bbbb" }, fakeCtx(session.id)),
        ).rejects.toThrow(/unknown instrumentation plan/)
      },
    })
  })

  test("rejects instrumentation_result without planId", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "tests time out")

        const tool = await DebugCaptureEvidenceTool.init()
        await expect(
          tool.execute({ caseId, kind: "instrumentation_result", content: "count=3" }, fakeCtx(session.id)),
        ).rejects.toThrow(/requires planId/)
      },
    })
  })

  test("links instrumentation_result evidence to its probe plan via planId", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "queue depth spikes under load")

        // Plan instrumentation probes.
        const targets = [
          {
            file: "src/queue.ts",
            anchor: { symbol: "enqueue" },
            probe: "Log queue depth on every enqueue call",
            removeInstruction: "Remove the depth log after evidence is captured",
          },
        ]
        const planTool = await DebugPlanInstrumentationTool.init()
        const planInput = { caseId, purpose: "observe queue depth spikes", targets }
        const planned = await planTool.execute(planInput, fakeCtx(session.id))
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id as any,
          tool: "debug_plan_instrumentation",
          callID: "call-plan",
          status: "completed",
          metadata: planned.metadata,
          durationMs: 1,
        })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const planId = planned.metadata.planId as string

        // Capture evidence that references the probe plan.
        const evidenceTool = await DebugCaptureEvidenceTool.init()
        const result = await evidenceTool.execute(
          { caseId, kind: "instrumentation_result", content: "queueDepth=47 at t=1200ms", planId },
          { ...fakeCtx(session.id), callID: "evidence-call" },
        )

        // Evidence schema includes the planId provenance field.
        const parsed = DebugEvidenceSchema.parse(result.metadata.debugEvidence)
        expect(parsed.planId).toBe(planId)
        expect(parsed.kind).toBe("instrumentation_result")
        expect(result.output).toContain(`from plan ${planId}`)

        // Persisted evidence is reconstructable with the planId intact.
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id as any,
          tool: "debug_capture_evidence",
          callID: "call-evidence",
          status: "completed",
          metadata: result.metadata,
          durationMs: 1,
        })
        await new Promise((resolve) => setTimeout(resolve, 30))

        const loaded = SessionDebug.load(session.id)
        expect(loaded.evidence).toHaveLength(1)
        expect(loaded.evidence[0].planId).toBe(planId)

        // Reverse lookup via evidenceByPlanId.
        const byPlan = SessionDebug.evidenceByPlanId(session.id, planId)
        expect(byPlan).toHaveLength(1)
        expect(byPlan[0].evidenceId).toBe(result.metadata.evidenceId)
      },
    })
  })

  test("captures evidence without planId when no probes were used", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "crash on startup")

        const tool = await DebugCaptureEvidenceTool.init()
        const result = await tool.execute({ caseId, kind: "stack_trace", content: "Error: boom\n  at foo:1" }, fakeCtx(session.id))
        const parsed = DebugEvidenceSchema.parse(result.metadata.debugEvidence)
        expect(parsed.planId).toBeUndefined()
      },
    })
  })
})
