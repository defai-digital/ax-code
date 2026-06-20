import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { WorkflowFixtureSpecs, WorkflowRun, evaluateWorkflowRun, parseWorkflowSpecV1 } from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("workflow eval summary", () => {
  test("reports cost per verified completion and confirmed finding", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
        await WorkflowRun.setStatus({ id: run.id, status: "running" })
        await WorkflowRun.appendBudgetUsage({
          runID: run.id,
          kind: "consume",
          usageDelta: {
            totalTokens: 120,
            inputTokens: 80,
            outputTokens: 40,
            estimatedCostUsd: 0.06,
          },
        })
        await WorkflowRun.appendArtifact({
          runID: run.id,
          kind: "finding",
          retention: "session",
          summary: "confirmed defect: missing validation",
          payload: { status: "confirmed" },
        })
        await WorkflowRun.appendArtifact({
          runID: run.id,
          kind: "finding",
          retention: "session",
          summary: "confirmed defect: stale cache write",
          payload: { status: "confirmed" },
        })
        await WorkflowRun.setStatus({ id: run.id, status: "completed" })

        const summary = evaluateWorkflowRun({ run: await WorkflowRun.getDetail(run.id), now: Date.now() })

        expect(summary.metrics.confirmedFindings).toBe(2)
        expect(summary.metrics.verifiedCompletionCount).toBe(1)
        expect(summary.metrics.costPerConfirmedFindingUsd).toBeCloseTo(0.03)
        expect(summary.metrics.costPerVerifiedCompletionUsd).toBeCloseTo(0.06)
        expect(summary.verificationSatisfied).toBe(true)
      },
    })
  })
})
