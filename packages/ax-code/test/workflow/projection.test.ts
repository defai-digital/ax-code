import { afterEach, describe, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { WorkflowFixtureSpecs, WorkflowRun, WorkflowScheduler, parseWorkflowSpecV1 } from "../../src/workflow"
import { summarizeWorkflowRunDetail } from "../../src/workflow/projection"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("workflow projections", () => {
  test("summarizes run state for supervision surfaces", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const started = await WorkflowScheduler.start(run.id, {
            allowScaleBeyondDefaults: true,
            autoStartChildren: false,
          })
          await WorkflowRun.appendArtifact({
            runID: run.id,
            phaseID: started.phases[0]?.id,
            kind: "metric",
            retention: "session",
            summary: "linked evidence",
            evidenceRefs: [{ kind: "debug-evidence", id: "probe-1" }],
          })

          const detail = await WorkflowRun.getDetail(run.id)
          const projection = summarizeWorkflowRunDetail(detail, Date.now())

          expect(projection).toMatchObject({
            runID: run.id,
            status: "running",
            name: "Issue Triage",
            currentPhaseName: "Collect Issues",
            effort: "workflow",
            models: {
              cheap: "cheap",
              strong: "strong",
              worker: "cheap",
              synthesizer: "strong",
            },
            phaseCounts: {
              queued: 1,
              running: 1,
              completed: 0,
            },
            childCounts: {
              queued: 8,
              running: 0,
              blockedPermission: 0,
              completed: 0,
            },
            artifactCounts: {
              summary: 0,
              finding: 0,
              verification: 0,
              metric: 1,
              log: 1,
            },
            verificationEnvelopeCount: 0,
            evidenceRefCount: 1,
          })
          expect(projection.budgetUsage.childAgents).toBe(8)
          expect(projection.budgetLimit.maxConcurrentAgents).toBe(8)
          expect(projection.budgetLimit.maxInputTokensPerChild).toBe(50_000)
          expect(projection.budgetLimit.maxOutputTokensPerChild).toBe(8_000)
          expect(projection.evaluation).toMatchObject({
            decision: "hold",
            metrics: {
              status: "running",
              childAgents: 8,
              verifiedCompletionCount: 0,
            },
          })
          expect(projection.elapsedMs).toBeGreaterThanOrEqual(0)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})
