import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { TaskQueue } from "../../src/session/task-queue"
import { WorkflowRun, WorkflowScheduler, WorkflowTaskQueue, parseWorkflowSpecV1 } from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

describe("workflow queue terminal status", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Instance.disposeAll()
  })

  test.each(["vote-with-critic", "critic-confirmation"] as const)(
    "%s waits when the critic completes before the workers",
    async (mergeStrategy) => {
      await using tmp = await tmpdir({ git: true })
      const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
      process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const spec = parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "critic-first",
              name: "Critic First",
              description: "A successful critic must wait for the worker majority.",
              budget: { maxConcurrentAgents: 3, maxTotalAgents: 4 },
              phases: [
                {
                  id: "race",
                  name: "Race",
                  kind: "fanout",
                  inputs: ["a", "b", "critic"],
                  maxParallel: 3,
                  mergeStrategy,
                },
                { id: "summarize", name: "Summarize", kind: "synthesis", dependsOn: ["race"] },
              ],
            })
            const run = await WorkflowRun.create({ spec })
            await WorkflowScheduler.start(run.id, { autoStartChildren: false })

            const queue = await TaskQueue.list()
            const detail = await WorkflowRun.getDetail(run.id)
            const phase = detail.phases.find((candidate) => candidate.specPhaseID === "race")!
            const children = detail.children.filter((candidate) => candidate.phaseID === phase.id)
            expect(children).toHaveLength(3)
            const workflowOf = (candidate: TaskQueue.Info) =>
              candidate.payload["workflow"] as { childID?: string; specPhaseID?: string } | undefined
            const itemFor = (childID: string) => queue.find((candidate) => workflowOf(candidate)?.childID === childID)!

            const critic = children.at(-1)!
            await TaskQueue.setStatus({ id: itemFor(critic.id).id, status: "completed" })
            const waiting = await WorkflowRun.getDetail(run.id)
            expect(waiting.status).toBe("running")
            expect(waiting.phases.find((candidate) => candidate.id === phase.id)?.status).toBe("running")
            expect(waiting.phases.find((candidate) => candidate.specPhaseID === "summarize")?.status).toBe("queued")

            await TaskQueue.setStatus({ id: itemFor(children[0]!.id).id, status: "completed" })
            const merged = await WorkflowRun.getDetail(run.id)
            expect(merged.phases.find((candidate) => candidate.id === phase.id)?.status).toBe("completed")
            expect(merged.phases.find((candidate) => candidate.specPhaseID === "summarize")?.status).toBe("running")
          },
        })
      } finally {
        if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
        else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
      }
    },
  )
  test("a cancelled run stays cancelled when a later queue sync arrives", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "critic-first",
            name: "Critic First",
            description: "A successful critic must wait for the worker majority.",
            budget: { maxConcurrentAgents: 3, maxTotalAgents: 4 },
            phases: [
              {
                id: "race",
                name: "Race",
                kind: "fanout",
                inputs: ["a", "b", "critic"],
                maxParallel: 3,
                mergeStrategy: "first-success",
              },
              { id: "summarize", name: "Summarize", kind: "synthesis", dependsOn: ["race"] },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          await WorkflowScheduler.start(run.id, { autoStartChildren: false })

          const queue = await TaskQueue.list()
          const detail = await WorkflowRun.getDetail(run.id)
          const phase = detail.phases.find((candidate) => candidate.specPhaseID === "race")!
          const children = detail.children.filter((candidate) => candidate.phaseID === phase.id)
          expect(children).toHaveLength(3)
          const workflowOf = (candidate: TaskQueue.Info) =>
            candidate.payload["workflow"] as { childID?: string; specPhaseID?: string } | undefined
          const itemFor = (childID: string) => queue.find((candidate) => workflowOf(candidate)?.childID === childID)!

          await TaskQueue.setStatus({ id: itemFor(children[0]!.id).id, status: "completed" })
          const advanced = await WorkflowRun.getDetail(run.id)
          expect(advanced.phases.find((candidate) => candidate.id === phase.id)?.status).toBe("completed")
          const cancelled = await WorkflowScheduler.cancel(run.id)
          expect(cancelled.status).toBe("cancelled")
          const synthesis = (await TaskQueue.list()).find(
            (candidate) => workflowOf(candidate)?.specPhaseID === "summarize",
          )!
          expect(synthesis.status).toBe("cancelled")
          const start = vi.spyOn(WorkflowScheduler, "start")
          await WorkflowTaskQueue.syncItem(synthesis)
          const after = await WorkflowRun.getDetail(run.id)
          expect(after.status).toBe("cancelled")
          expect(after.time.completed).toBe(cancelled.time.completed)
          expect(start).not.toHaveBeenCalled()
          const synthesisPhase = after.phases.find((candidate) => candidate.specPhaseID === "summarize")!
          const retried = await WorkflowScheduler.retryPhase(run.id, synthesisPhase.id)
          expect(retried.status).toBe("running")
          expect(retried.phases.find((candidate) => candidate.id === synthesisPhase.id)?.status).toBe("running")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
  test.each(["completed", "failed", "stop-failure"] as const)(
    "a sibling %s outcome survives stop admission",
    async (outcome) => {
      await using tmp = await tmpdir({ git: true })
      const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
      process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const spec = parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "critic-first",
              name: "Critic First",
              description: "A successful critic must wait for the worker majority.",
              budget: { maxConcurrentAgents: 3, maxTotalAgents: 4 },
              phases: [
                {
                  id: "race",
                  name: "Race",
                  kind: "fanout",
                  inputs: ["a", "b", "critic"],
                  maxParallel: 3,
                  mergeStrategy: "first-success",
                },
                { id: "summarize", name: "Summarize", kind: "synthesis", dependsOn: ["race"] },
              ],
            })
            const run = await WorkflowRun.create({ spec })
            await WorkflowScheduler.start(run.id, { autoStartChildren: false })

            const queue = await TaskQueue.list()
            const detail = await WorkflowRun.getDetail(run.id)
            const phase = detail.phases.find((candidate) => candidate.specPhaseID === "race")!
            const children = detail.children.filter((candidate) => candidate.phaseID === phase.id)
            expect(children).toHaveLength(3)
            const workflowOf = (candidate: TaskQueue.Info) =>
              candidate.payload["workflow"] as { childID?: string; specPhaseID?: string } | undefined
            const itemFor = (childID: string) => queue.find((candidate) => workflowOf(candidate)?.childID === childID)!

            const sibling = itemFor(children[1]!.id)
            vi.spyOn(TaskQueue, "stop").mockImplementationOnce(async (id) => {
              expect(id).toBe(sibling.id)
              if (outcome !== "stop-failure") await TaskQueue.setStatus({ id, status: outcome })
              throw new Error("Stop admission raced a queue update or failed before cancellation.")
            })
            await TaskQueue.setStatus({ id: itemFor(children[0]!.id).id, status: "completed" })
            const after = await WorkflowRun.getDetail(run.id)
            const settledSibling = after.children.find((candidate) => candidate.id === children[1]!.id)!
            expect((await TaskQueue.get(sibling.id)).status).toBe(outcome === "stop-failure" ? "queued" : outcome)
            expect(settledSibling.status).toBe(outcome === "stop-failure" ? "queued" : outcome)
            expect(settledSibling.error).toBeUndefined()
          },
        })
      } finally {
        if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
        else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
      }
    },
  )
})
