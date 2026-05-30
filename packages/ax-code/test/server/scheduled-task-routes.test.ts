import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueueID } from "../../src/session/schema"
import { TaskQueue } from "../../src/session/task-queue"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("scheduled task routes", () => {
  test("creates scheduled automations and turns run-now into queue items", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
        const runAt = Date.now() + 86_400_000
        const createdResponse = await app.request(`/scheduled-task?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Daily GUI review",
            prompt: "Review the current branch and summarize risk.",
            schedule: { type: "once", runAt },
            agent: "review",
            model: { providerID: "openai", modelID: "gpt-5-codex" },
          }),
        })
        expect(createdResponse.status).toBe(200)
        const created = (await createdResponse.json()) as {
          id: string
          status: string
          nextRunAt: number
          agent: string
        }
        expect(created.id).toStartWith("sch_")
        expect(created.status).toBe("active")
        expect(created.nextRunAt).toBe(runAt)
        expect(created.agent).toBe("review")

        const listResponse = await app.request(`/scheduled-task?${directoryQuery}`)
        expect(listResponse.status).toBe(200)
        const list = (await listResponse.json()) as Array<{ id: string }>
        expect(list.map((item) => item.id)).toEqual([created.id])

        const pauseResponse = await app.request(`/scheduled-task/${created.id}/pause?${directoryQuery}`, {
          method: "POST",
        })
        expect(pauseResponse.status).toBe(200)
        expect(await pauseResponse.json()).toMatchObject({ id: created.id, status: "paused" })

        const resumeResponse = await app.request(`/scheduled-task/${created.id}/resume?${directoryQuery}`, {
          method: "POST",
        })
        expect(resumeResponse.status).toBe(200)
        expect(await resumeResponse.json()).toMatchObject({ id: created.id, status: "active" })

        const runNowResponse = await app.request(`/scheduled-task/${created.id}/run-now?${directoryQuery}`, {
          method: "POST",
        })
        expect(runNowResponse.status).toBe(200)
        const runNow = (await runNowResponse.json()) as {
          task: { id: string; lastQueueID: string; lastRunAt: number }
          queueItem: {
            id: string
            kind: string
            status: string
            sourceTaskID: string
            payload: Record<string, unknown>
          }
        }
        expect(runNow.task.id).toBe(created.id)
        expect(runNow.task.lastQueueID).toBe(runNow.queueItem.id)
        expect(runNow.task.lastRunAt).toBeGreaterThan(0)
        expect(runNow.queueItem).toMatchObject({
          kind: "automation",
          status: "queued",
          sourceTaskID: created.id,
        })
        expect(runNow.queueItem.payload.prompt).toBe("Review the current branch and summarize risk.")

        const queue = await TaskQueue.list()
        expect(queue.map((item) => String(item.id))).toContain(runNow.queueItem.id)

        const deleteResponse = await app.request(`/scheduled-task/${created.id}?${directoryQuery}`, {
          method: "DELETE",
        })
        expect(deleteResponse.status).toBe(200)
        expect(await deleteResponse.json()).toBe(true)
      },
    })
  })

  test("scheduler loop creates queue items for due scheduled tasks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await ScheduledTask.create({
          title: "Due GUI review",
          prompt: "Review the branch after the scheduler fires.",
          schedule: { type: "once", runAt: Date.now() + 20 },
        })

        ScheduledTask.initScheduler({ pollMs: 10 })

        const queueItem = await waitForValue(async () => {
          const refreshed = await ScheduledTask.get(task.id)
          if (!refreshed.lastQueueID) return undefined
          return TaskQueue.get(TaskQueueID.make(refreshed.lastQueueID))
        })

        expect(queueItem).toMatchObject({
          kind: "automation",
          status: "queued",
          sourceTaskID: task.id,
        })
        const refreshed = await ScheduledTask.get(task.id)
        expect(refreshed.lastRunAt).toBeGreaterThan(0)
        expect(refreshed.nextRunAt).toBeUndefined()
      },
    })
  })

  test("run-now can create workflow runs for workflow scheduled tasks", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      const app = Server.Default()

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
          const createdResponse = await app.request(`/scheduled-task?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: "Daily workflow audit",
              prompt: "Run the saved workflow template.",
              schedule: { type: "once", runAt: Date.now() + 86_400_000 },
              workflowTemplateID: "builtin:noop-dry-run",
              workflowStartOptions: { enqueueChildren: true },
            }),
          })
          expect(createdResponse.status).toBe(200)
          const created = (await createdResponse.json()) as { id: string; workflowTemplateID: string }
          expect(created.workflowTemplateID).toBe("builtin:noop-dry-run")

          const runNowResponse = await app.request(`/scheduled-task/${created.id}/run-now?${directoryQuery}`, {
            method: "POST",
          })
          expect(runNowResponse.status).toBe(200)
          const runNow = (await runNowResponse.json()) as {
            task: { id: string; lastWorkflowRunID: string; lastRunAt: number }
            workflowRun: { id: string; status: string; sourceTemplateID: string }
            queueItem?: unknown
          }

          expect(runNow.queueItem).toBeUndefined()
          expect(runNow.workflowRun).toMatchObject({
            status: "completed",
            sourceTemplateID: "builtin:noop-dry-run",
          })
          expect(runNow.task.lastWorkflowRunID).toBe(runNow.workflowRun.id)
          expect(runNow.task.lastRunAt).toBeGreaterThan(0)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})

async function waitForValue<T>(read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Timed out waiting for scheduled task value")
}
