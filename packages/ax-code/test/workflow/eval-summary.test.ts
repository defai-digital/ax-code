import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { evaluateWorkflowRun } from "../../src/workflow/eval"
import { WorkflowFixtureSpecs, WorkflowRun, parseWorkflowSpecV1 } from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("workflow eval summary", () => {
  test("promotes completed verified sweeps that beat the baseline", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.verifiedBugSweep) })
        await WorkflowRun.setStatus({ id: run.id, status: "running" })
        const detail = await WorkflowRun.getDetail(run.id)
        const scan = detail.phases.find((phase) => phase.specPhaseID === "scan-files")!
        const verification = detail.phases.find((phase) => phase.specPhaseID === "cross-check")!
        const finalReport = detail.phases.find((phase) => phase.specPhaseID === "final-report")!

        await WorkflowRun.appendArtifact({
          runID: run.id,
          phaseID: scan.id,
          specArtifactID: "candidate-findings",
          kind: "finding",
          summary: "confirmed defect in parser",
          payload: { status: "confirmed" },
        })
        await WorkflowRun.appendArtifact({
          runID: run.id,
          phaseID: scan.id,
          specArtifactID: "candidate-findings",
          kind: "finding",
          summary: "rejected false positive in renderer",
          payload: { status: "false_positive" },
        })
        await WorkflowRun.appendArtifact({
          runID: run.id,
          phaseID: verification.id,
          specArtifactID: "verification-summary",
          kind: "verification",
          summary: "verification evidence captured",
        })
        await WorkflowRun.appendArtifact({
          runID: run.id,
          phaseID: finalReport.id,
          specArtifactID: "bug-sweep-report",
          kind: "summary",
          summary: "final bug sweep report",
        })
        await WorkflowRun.appendBudgetUsage({
          runID: run.id,
          kind: "consume",
          usageDelta: { totalTokens: 5_000, inputTokens: 4_000, outputTokens: 1_000, childAgents: 4 },
        })
        await WorkflowRun.attachVerificationEnvelopeIDs({ id: run.id, envelopeIDs: ["0123456789abcdef"] })
        await WorkflowRun.setStatus({ id: run.id, status: "completed" })

        const summary = evaluateWorkflowRun({
          run: await WorkflowRun.getDetail(run.id),
          baseline: {
            label: "single-agent",
            metrics: {
              confirmedFindings: 1,
              falsePositiveFindings: 1,
              totalTokens: 4_000,
              elapsedMs: 10_000,
              interventionCount: 0,
            },
          },
          now: Date.now(),
        })

        expect(summary.decision).toBe("promote")
        expect(summary.verificationSatisfied).toBe(true)
        expect(summary.metrics.confirmedFindings).toBe(1)
        expect(summary.metrics.falsePositiveFindings).toBe(1)
        expect(summary.comparison).toMatchObject({
          baselineLabel: "single-agent",
          confirmedFindingsDelta: 0,
          falsePositiveFindingsDelta: 0,
          totalTokensDelta: 1_000,
        })
      },
    })
  })

  test("holds required-verification runs without evidence", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.verifiedBugSweep) })
        await WorkflowRun.setStatus({ id: run.id, status: "completed" })

        const summary = evaluateWorkflowRun({ run: await WorkflowRun.getDetail(run.id) })

        expect(summary.decision).toBe("hold")
        expect(summary.verificationSatisfied).toBe(false)
        expect(summary.reasons).toContain("required verification evidence is missing")
      },
    })
  })

  test("holds required-verification runs when only an envelope is attached", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.verifiedBugSweep) })
        await WorkflowRun.attachVerificationEnvelopeIDs({ id: run.id, envelopeIDs: ["0123456789abcdef"] })
        await WorkflowRun.setStatus({ id: run.id, status: "completed" })

        const detail = await WorkflowRun.getDetail(run.id)
        const summary = evaluateWorkflowRun({ run: detail })

        expect(detail.status).toBe("blocked")
        expect(summary.decision).toBe("hold")
        expect(summary.verificationSatisfied).toBe(false)
        expect(summary.reasons).toContain("required verification evidence is missing")
      },
    })
  })

  test("rolls back runs that exceed hard budgets", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
        await WorkflowRun.setStatus({ id: run.id, status: "running" })
        await WorkflowRun.appendBudgetUsage({
          runID: run.id,
          kind: "consume",
          usageDelta: { totalTokens: 200_000 },
        })

        const summary = evaluateWorkflowRun({ run: await WorkflowRun.getDetail(run.id) })

        expect(summary.decision).toBe("rollback")
        expect(summary.budgetStatus).toBe("exceeded")
        expect(summary.reasons.some((reason) => reason.includes("budget exceeded"))).toBe(true)
      },
    })
  })
})
