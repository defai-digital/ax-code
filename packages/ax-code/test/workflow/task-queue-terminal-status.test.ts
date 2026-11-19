import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { TaskQueue } from "../../src/session/task-queue"
import { WorkflowRun, WorkflowScheduler, WorkflowTaskQueue, parseWorkflowSpecV1 } from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

describe("workflow queue terminal status", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Instance.disposeAll()
    vi.unstubAllEnvs()
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
  test.each(["workflow read", "phase write", "run write"] as const)(
    "an earlier queue notification cannot reopen a completed workflow after a delayed %s",
    async (delay) => {
      vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "delayed-queue-status",
              name: "Delayed queue status",
              description: "Workflow status must follow the current queue item.",
              phases: [{ id: "work", name: "Work", kind: "fanout", inputs: ["worker"], maxParallel: 1 }],
            }),
          })
          await WorkflowScheduler.start(run.id, { autoStartChildren: false })
          const [item] = await TaskQueue.list()
          const observed = Promise.withResolvers<void>()
          const release = Promise.withResolvers<void>()
          const waitForCompletion = async () => {
            observed.resolve()
            await release.promise
          }
          if (delay === "workflow read") {
            const getDetail = WorkflowRun.getDetail
            vi.spyOn(WorkflowRun, "getDetail").mockImplementationOnce(async (id) => {
              const detail = await getDetail(id)
              await waitForCompletion()
              return detail
            })
          } else if (delay === "phase write") {
            const setPhaseStatus = WorkflowRun.setPhaseStatus
            vi.spyOn(WorkflowRun, "setPhaseStatus").mockImplementationOnce(async (...args) => {
              await waitForCompletion()
              return setPhaseStatus(...args)
            })
          } else {
            const setStatus = WorkflowRun.setStatus
            vi.spyOn(WorkflowRun, "setStatus").mockImplementationOnce(async (...args) => {
              await waitForCompletion()
              return setStatus(...args)
            })
          }

          const earlier = TaskQueue.setStatus({ id: item.id, status: delay === "workflow read" ? "running" : "paused" })
          try {
            await Promise.race([
              observed.promise,
              earlier.then(() => {
                throw new Error("Expected the earlier notification to wait while the workflow completes")
              }),
            ])
            await TaskQueue.setStatus({ id: item.id, status: "completed" })
            expect((await WorkflowRun.get(run.id)).status).toBe("completed")
          } finally {
            release.resolve()
            await earlier
          }

          expect((await TaskQueue.get(item.id)).status).toBe("completed")
          expect(await WorkflowRun.getDetail(run.id)).toMatchObject({
            status: "completed",
            phases: [{ status: "completed" }],
            children: [{ status: "completed" }],
          })
        },
      })
    },
  )

  test.each(["phase", "run"] as const)(
    "a current queue notification cannot apply a stale %s aggregate",
    async (target) => {
      vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({
            spec: parseWorkflowSpecV1({
              schemaVersion: 1,
              id: "overlapping-sibling-status",
              name: "Overlapping sibling status",
              description: "A successful sibling can finish a phase while an older aggregate is pending.",
              phases: [
                {
                  id: "work",
                  name: "Work",
                  kind: "fanout",
                  inputs: ["first", "second"],
                  maxParallel: 2,
                  mergeStrategy: "first-success",
                },
              ],
            }),
          })
          await WorkflowScheduler.start(run.id, { autoStartChildren: false })
          const [winner, sibling] = await TaskQueue.list()
          const firstWaiting = Promise.withResolvers<void>()
          const secondWaiting = Promise.withResolvers<void>()
          const release = Promise.withResolvers<void>()
          const waitForWinner = async (item: TaskQueue.Info | undefined) => {
            if (item?.id === winner.id) firstWaiting.resolve()
            else secondWaiting.resolve()
            await release.promise
          }
          if (target === "phase") {
            const setPhaseStatus = WorkflowRun.setPhaseStatus
            vi.spyOn(WorkflowRun, "setPhaseStatus").mockImplementation(async (input, options) => {
              if (input.status === "paused") await waitForWinner(options?.queueItem)
              return setPhaseStatus(input, options)
            })
          } else {
            const setStatus = WorkflowRun.setStatus
            vi.spyOn(WorkflowRun, "setStatus").mockImplementation(async (input, options) => {
              if (input.status === "paused") await waitForWinner(options?.queueItem)
              return setStatus(input, options)
            })
          }

          const paused = TaskQueue.setStatus({ id: winner.id, status: "paused" })
          let failed: Promise<TaskQueue.Info> | undefined
          try {
            await Promise.race([
              firstWaiting.promise,
              paused.then(() => {
                throw new Error("Expected the paused aggregate to wait")
              }),
            ])
            failed = TaskQueue.setStatus({ id: sibling.id, status: "failed", error: "Sibling failed" })
            await Promise.race([
              secondWaiting.promise,
              failed.then(() => {
                throw new Error("Expected the sibling aggregate to wait")
              }),
            ])
            await TaskQueue.setStatus({ id: winner.id, status: "completed" })
            expect((await WorkflowRun.get(run.id)).status).toBe("completed")
          } finally {
            release.resolve()
            await Promise.all([paused, failed])
          }

          expect((await TaskQueue.get(sibling.id)).status).toBe("failed")
          expect(await WorkflowRun.getDetail(run.id)).toMatchObject({
            status: "completed",
            phases: [{ status: "completed" }],
          })
        },
      })
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
