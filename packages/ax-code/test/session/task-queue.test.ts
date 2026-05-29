import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { TaskQueue } from "../../src/session/task-queue"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("TaskQueue", () => {
  test("persists lifecycle state and publishes durable queue events", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const events: string[] = []
        const unsubscribeCreated = Bus.subscribe(TaskQueue.Event.Created, (event) => {
          events.push(event.type)
        })
        const unsubscribeUpdated = Bus.subscribe(TaskQueue.Event.Updated, (event) => {
          events.push(`${event.type}:${event.properties.item.status}`)
        })
        const unsubscribeDeleted = Bus.subscribe(TaskQueue.Event.Deleted, (event) => {
          events.push(event.type)
        })

        try {
          const created = await TaskQueue.enqueue({
            sessionID: session.id,
            kind: "prompt",
            title: "Run desktop follow-up",
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            sourceMessageID: "msg_task_queue_source",
            sourceTaskID: "tsk_task_queue_parent",
            priority: 5,
            payload: { prompt: "continue" },
          })

          expect(created.id).toStartWith("tsk_")
          expect(created.projectID).toBe(session.projectID)
          expect(created.sessionID).toBe(session.id)
          expect(created.status).toBe("queued")
          expect(created.agent).toBe("build")
          expect(created.model).toEqual({ providerID: "test", modelID: "test-model" })
          expect(created.sourceMessageID).toBe("msg_task_queue_source")
          expect(created.sourceTaskID).toBe("tsk_task_queue_parent")

          const list = await TaskQueue.list({ sessionID: session.id })
          expect(list.map((item) => item.id)).toEqual([created.id])

          const running = await TaskQueue.setStatus({ id: created.id, status: "running" })
          expect(running.time.started).toBeDefined()

          const paused = await TaskQueue.pause(created.id)
          expect(paused.status).toBe("paused")

          const resumed = await TaskQueue.resume(created.id)
          expect(resumed.status).toBe("queued")

          const failed = await TaskQueue.setStatus({ id: created.id, status: "failed", error: "model failed" })
          expect(failed.error).toBe("model failed")
          expect(failed.time.completed).toBeDefined()

          const retried = await TaskQueue.retry(created.id)
          expect(retried.status).toBe("queued")
          expect(retried.error).toBeUndefined()
          expect(retried.time.started).toBeUndefined()
          expect(retried.time.completed).toBeUndefined()

          const reordered = await TaskQueue.reorder({ id: created.id, position: 10 })
          expect(reordered.position).toBe(10)

          const sentNow = await TaskQueue.sendNow(created.id)
          expect(sentNow.status).toBe("queued")
          expect(sentNow.position).toBe(0)

          expect(await TaskQueue.remove(created.id)).toBe(true)
          expect(await TaskQueue.list({ sessionID: session.id })).toEqual([])
          await new Promise((resolve) => setTimeout(resolve, 0))

          expect(events).toContain("task.queue.created")
          expect(events).toContain("task.queue.updated:running")
          expect(events).toContain("task.queue.updated:failed")
          expect(events).toContain("task.queue.deleted")
        } finally {
          unsubscribeCreated()
          unsubscribeUpdated()
          unsubscribeDeleted()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("orders project queue items by server position", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await TaskQueue.enqueue({ kind: "review", title: "Review first branch" })
        const second = await TaskQueue.enqueue({ kind: "automation", title: "Run smoke checks" })

        expect((await TaskQueue.list()).map((item) => item.id)).toEqual([first.id, second.id])

        await TaskQueue.reorder({ id: second.id, position: 0 })
        await TaskQueue.reorder({ id: first.id, position: 1 })

        expect((await TaskQueue.list()).map((item) => item.id)).toEqual([second.id, first.id])

        await TaskQueue.sendNow(first.id)
        expect((await TaskQueue.list()).map((item) => item.id)).toEqual([first.id, second.id])

        await TaskQueue.remove(first.id)
        await TaskQueue.remove(second.id)
      },
    })
  })
})
