import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
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
})
