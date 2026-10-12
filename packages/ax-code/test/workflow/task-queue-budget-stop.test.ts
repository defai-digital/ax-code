import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { TaskQueue } from "../../src/session/task-queue"
import { WorkflowRun, WorkflowScheduler, WorkflowTaskQueue, parseWorkflowSpecV1 } from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

// The budget enforcement (WorkflowRun.appendBudgetUsage) marks the child, the
// phase, and the run failed and records an "exceeded" ledger entry. A later
// sibling completion re-runs WorkflowTaskQueue.syncItem's aggregation, which
// must not recompute the deliberately failed phase/run back to life (that
// would start the next phase and keep spending tokens).
describe("workflow budget stop", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Instance.disposeAll()
  })

  test("a budget-failed first-success phase is not resurrected by a sibling completion", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "budget-stop",
            name: "Budget Stop",
            description: "A budget-failed run must not be revived by a later sibling completion.",
            budget: { maxTotalTokens: 100, maxConcurrentAgents: 2, maxTotalAgents: 3 },
            phases: [
              {
                id: "race",
                name: "Race",
                kind: "fanout",
                inputs: ["a", "b"],
                maxParallel: 2,
                mergeStrategy: "first-success",
              },
              { id: "summarize", name: "Summarize", kind: "synthesis", dependsOn: ["race"] },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id)

          const queue = await TaskQueue.list()
          const detail = await WorkflowRun.getDetail(run.id)
          const phase = detail.phases.find((candidate) => candidate.specPhaseID === "race")!
          const children = detail.children.filter((candidate) => candidate.phaseID === phase.id)
          expect(children).toHaveLength(2)
          const workflowOf = (candidate: TaskQueue.Info) =>
            candidate.payload["workflow"] as { childID?: string; specPhaseID?: string } | undefined
          const itemFor = (childID: string) => queue.find((candidate) => workflowOf(candidate)?.childID === childID)!

          // The first child blows the run budget.
          await WorkflowRun.appendBudgetUsage({
            runID: run.id,
            phaseID: phase.id,
            childID: children[0]!.id,
            kind: "consume",
            usageDelta: { totalTokens: 1_000 },
          })

          const stopped = await WorkflowRun.getDetail(run.id)
          expect(stopped.status).toBe("failed")
          expect(stopped.phases.find((candidate) => candidate.id === phase.id)?.status).toBe("failed")
          expect(stopped.phases.find((candidate) => candidate.specPhaseID === "summarize")?.status).toBe("queued")

          // The sibling completes afterwards: the recompute must keep the
          // budget-failed phase and run failed and must not start the next
          // phase.
          const start = vi.spyOn(WorkflowScheduler, "start")
          const sibling = itemFor(children[1]!.id)
          await TaskQueue.setStatus({ id: sibling.id, status: "completed" })
          await WorkflowTaskQueue.syncItem(await TaskQueue.get(sibling.id))

          const after = await WorkflowRun.getDetail(run.id)
          expect(after.status).toBe("failed")
          expect(after.phases.find((candidate) => candidate.id === phase.id)?.status).toBe("failed")
          expect(after.phases.find((candidate) => candidate.specPhaseID === "summarize")?.status).toBe("queued")
          expect(start).not.toHaveBeenCalled()
          expect(
            (await TaskQueue.list()).filter((candidate) => workflowOf(candidate)?.specPhaseID === "summarize"),
          ).toHaveLength(0)
          expect(after.error).toContain("budget")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})
