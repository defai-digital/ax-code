import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import {
  WorkflowFixtureSpecs,
  WorkflowRun,
  WorkflowRunID,
  WorkflowScheduler,
  WorkflowSchedulerDisabledError,
  parseWorkflowSpecV1,
} from "../../src/workflow"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("WorkflowScheduler", () => {
  test("stays behind AX_CODE_WORKFLOW_RUNTIME", async () => {
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    try {
      delete process.env.AX_CODE_WORKFLOW_RUNTIME
      await expect(WorkflowScheduler.start(WorkflowRunID.ascending())).rejects.toThrow(WorkflowSchedulerDisabledError)
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("runs a noop workflow to completion without queueing children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun) })
          const result = await WorkflowScheduler.start(run.id)

          expect(result.status).toBe("completed")
          expect(result.phases[0]?.status).toBe("completed")
          expect(result.artifacts[0]?.kind).toBe("summary")
          expect(result.children).toEqual([])
          const { TaskQueue } = await import("../../src/session/task-queue")
          expect(await TaskQueue.list()).toEqual([])
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("bridges the first executable phase into TaskQueue subagent items", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const result = await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })

          expect(result.status).toBe("running")
          expect(result.phases[0]?.status).toBe("running")
          expect(result.phases[1]?.status).toBe("queued")
          expect(result.children).toHaveLength(8)
          expect(result.children.every((child) => child.taskQueueID?.startsWith("tsk_"))).toBe(true)
          expect(result.children.every((child) => child.sessionID?.startsWith("ses_"))).toBe(true)
          expect(result.budgetUsage.childAgents).toBe(8)

          const { TaskQueue } = await import("../../src/session/task-queue")
          const queue = await TaskQueue.list()
          expect(queue).toHaveLength(8)
          expect(queue.every((item) => item.kind === "subagent")).toBe(true)
          expect(queue.every((item) => item.sessionID?.startsWith("ses_"))).toBe(true)
          expect(queue[0]?.payload.workflow).toMatchObject({
            runID: run.id,
            phaseID: result.phases[0]?.id,
            specPhaseID: "collect-issues",
          })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("executes workflow subagent queue payloads through TaskQueueExecutor", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const { TaskQueueExecutor } = await import("../../src/session/task-queue-executor")
          const [first] = await TaskQueue.list()
          expect(first?.sessionID).toStartWith("ses_")

          const edited = await TaskQueue.edit({
            id: first!.id,
            payload: {
              ...first!.payload,
              body: {
                parts: [{ type: "text", text: "Record this workflow child without model execution." }],
                noReply: true,
                agentRouting: "preserve",
              },
            },
          })

          const running = await TaskQueueExecutor.start(edited)
          expect(running.status).toBe("running")
          await waitForValue("workflow queue completion", async () => {
            const item = await TaskQueue.get(first!.id)
            return item.status === "completed" ? item : undefined
          })

          const detail = await WorkflowRun.getDetail(run.id)
          const child = detail.children.find((candidate) => candidate.taskQueueID === first!.id)
          expect(child?.status).toBe("completed")
          expect(child?.sessionID).toBe(first?.sessionID)
          expect(detail.phases[0]?.status).toBe("running")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("syncs TaskQueue lifecycle back into workflow child and phase state", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const started = await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const [first] = await TaskQueue.list()
          expect(first).toBeDefined()

          await TaskQueue.setStatus({ id: first!.id, status: "running" })
          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")
          expect(detail.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("running")

          await TaskQueue.setStatus({ id: first!.id, status: "blocked_permission", error: "approval required" })
          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("blocked")
          expect(detail.phases[0]?.status).toBe("blocked")
          expect(detail.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("blocked_permission")

          await TaskQueue.setStatus({ id: first!.id, status: "running" })
          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")
          expect(detail.children).toHaveLength(started.children.length)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("advances to the next phase after all queued workflow children complete", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const firstPhaseQueue = await TaskQueue.list()

          for (const item of firstPhaseQueue) {
            await TaskQueue.setStatus({ id: item.id, status: "completed" })
          }

          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("completed")
          expect(detail.phases[1]?.status).toBe("running")
          expect(detail.children).toHaveLength(firstPhaseQueue.length + 1)

          const nextQueue = (await TaskQueue.list()).filter((item) => item.status === "queued")
          expect(nextQueue).toHaveLength(1)
          expect(nextQueue[0]?.payload.workflow).toMatchObject({
            runID: run.id,
            phaseID: detail.phases[1]?.id,
            specPhaseID: "synthesize-triage",
          })

          await TaskQueue.setStatus({ id: nextQueue[0]!.id, status: "completed" })
          detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("completed")
          expect(detail.phases.every((phase) => phase.status === "completed")).toBe(true)
          expect(detail.children.every((child) => child.status === "completed")).toBe(true)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("pauses and resumes queued workflow children without advancing future phases", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })

          const paused = await WorkflowScheduler.pause(run.id)
          expect(paused.status).toBe("paused")
          expect(paused.phases[0]?.status).toBe("paused")
          expect(paused.phases[1]?.status).toBe("queued")
          expect(paused.children.every((child) => child.status === "paused")).toBe(true)
          const { TaskQueue } = await import("../../src/session/task-queue")
          expect((await TaskQueue.list()).every((item) => item.status === "paused")).toBe(true)

          const resumed = await WorkflowScheduler.resume(run.id)
          expect(resumed.status).toBe("running")
          expect(resumed.phases[0]?.status).toBe("running")
          expect(resumed.phases[1]?.status).toBe("queued")
          expect(resumed.children.every((child) => child.status === "queued")).toBe(true)
          expect((await TaskQueue.list()).every((item) => item.status === "queued")).toBe(true)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("retries failed workflow queue children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })
          const { TaskQueue } = await import("../../src/session/task-queue")
          const [first] = await TaskQueue.list()

          await TaskQueue.setStatus({ id: first!.id, status: "failed", error: "model failed" })
          let detail = await WorkflowRun.getDetail(run.id)
          expect(detail.status).toBe("failed")
          expect(detail.phases[0]?.status).toBe("failed")
          expect(detail.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("failed")

          detail = await WorkflowScheduler.retry(run.id)
          expect(detail.status).toBe("running")
          expect(detail.phases[0]?.status).toBe("running")
          expect(detail.children.find((child) => child.taskQueueID === first!.id)?.status).toBe("queued")
          expect((await TaskQueue.get(first!.id)).status).toBe("queued")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("cancels queued workflow children and linked queue items", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          await WorkflowScheduler.start(run.id, { allowScaleBeyondDefaults: true })

          const cancelled = await WorkflowScheduler.cancel(run.id)

          expect(cancelled.status).toBe("cancelled")
          expect(cancelled.children.every((child) => child.status === "cancelled")).toBe(true)
          expect(cancelled.phases.every((phase) => phase.status === "cancelled")).toBe(true)
          const { TaskQueue } = await import("../../src/session/task-queue")
          expect((await TaskQueue.list()).every((item) => item.status === "cancelled")).toBe(true)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})

async function waitForValue<T>(label: string, read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
