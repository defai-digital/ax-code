import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import {
  DebugInstrumentationPlanSchema,
  DEBUG_ID_PATTERN,
} from "../../src/debug-engine/runtime-debug"
import { Recorder } from "../../src/replay/recorder"
import { Session } from "../../src/session"
import { SessionDebug } from "../../src/session/debug"
import { DebugPlanInstrumentationTool } from "../../src/tool/debug_plan_instrumentation"
import { tmpdir } from "../fixture/fixture"
import { emitOpenedCase, fakeCtx } from "./debug-fixture"

describe("DebugPlanInstrumentationTool", () => {
  const targets = [
    {
      file: "src/worker-pool.ts",
      anchor: { symbol: "acquireWorker" },
      probe: "Log queue depth and active worker count before waiting for a slot",
      removeInstruction: "Remove the temporary log after debug_capture_evidence records the queue-depth output",
    },
  ]

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

        const tool = await DebugPlanInstrumentationTool.init()
        await expect(
          tool.execute({ caseId: "0000aaaa1111bbbb", purpose: "measure queue depth", targets }, fakeCtx(session.id)),
        ).rejects.toThrow(/unknown debug case/)
      },
    })
  })

  test("records a schema-valid removable instrumentation plan", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "tests time out")

        const tool = await DebugPlanInstrumentationTool.init()
        const result = await tool.execute(
          { caseId, purpose: "measure queue depth before worker acquisition", targets },
          fakeCtx(session.id),
        )

        expect(result.metadata.planId).toMatch(DEBUG_ID_PATTERN)
        const parsed = DebugInstrumentationPlanSchema.parse(result.metadata.debugInstrumentationPlan)
        expect(parsed.caseId).toBe(caseId)
        expect(parsed.status).toBe("planned")
        expect(parsed.targets[0].removeInstruction).toContain("Remove")
        expect(parsed.source.tool).toBe("debug_plan_instrumentation")
      },
    })
  })

  test("same case + purpose + targets deduplicates to the same planId", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "tests time out")

        const tool = await DebugPlanInstrumentationTool.init()
        const input = { caseId, purpose: "measure queue depth before worker acquisition", targets }
        const first = await tool.execute(input, fakeCtx(session.id))
        const second = await tool.execute(input, fakeCtx(session.id))

        expect(first.metadata.planId).toBe(second.metadata.planId)
      },
    })
  })

  test("records applied and removed lifecycle updates for the same removable plan", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "tests time out")

        const tool = await DebugPlanInstrumentationTool.init()
        const input = { caseId, purpose: "measure queue depth before worker acquisition", targets }
        const planned = await tool.execute(input, fakeCtx(session.id))
        const applied = await tool.execute({ ...input, status: "applied" }, fakeCtx(session.id))
        const removed = await tool.execute({ ...input, status: "removed" }, fakeCtx(session.id))

        expect(applied.metadata.planId).toBe(planned.metadata.planId)
        expect(removed.metadata.planId).toBe(planned.metadata.planId)
        expect(applied.metadata.debugInstrumentationPlan.status).toBe("applied")
        expect(removed.metadata.debugInstrumentationPlan.status).toBe("removed")
        expect(removed.output).toContain("Recorded as removed")

        for (const [callID, result] of [
          ["call-plan", planned],
          ["call-applied", applied],
          ["call-removed", removed],
        ] as const) {
          Recorder.emit({
            type: "tool.result",
            sessionID: session.id as any,
            tool: "debug_plan_instrumentation",
            callID,
            status: "completed",
            metadata: result.metadata,
            durationMs: 1,
          })
        }
        await new Promise((resolve) => setTimeout(resolve, 30))

        const loaded = SessionDebug.load(session.id)
        expect(loaded.instrumentationPlans).toHaveLength(1)
        expect(loaded.instrumentationPlans[0]).toMatchObject({
          planId: planned.metadata.planId,
          status: "removed",
        })
      },
    })
  })

  test("rollup planSummary reflects instrumentation plan counts per case", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const caseId = await emitOpenedCase(session.id, tmp.path, "queue depth spikes")

        const tool = await DebugPlanInstrumentationTool.init()
        const input = { caseId, purpose: "measure queue depth", targets }
        const planned = await tool.execute(input, fakeCtx(session.id))
        const removed = await tool.execute({ ...input, status: "removed" }, fakeCtx(session.id))

        for (const [callID, result] of [
          ["call-plan", planned],
          ["call-removed", removed],
        ] as const) {
          Recorder.emit({
            type: "tool.result",
            sessionID: session.id as any,
            tool: "debug_plan_instrumentation",
            callID,
            status: "completed",
            metadata: result.metadata,
            durationMs: 1,
          })
        }
        await new Promise((resolve) => setTimeout(resolve, 30))

        const debug = SessionDebug.load(session.id)
        const rollups = SessionDebug.rollup(debug)
        expect(rollups).toHaveLength(1)
        expect(rollups[0].planSummary).toMatchObject({ total: 1, applied: 0, removed: 1 })
      },
    })
  })
})
