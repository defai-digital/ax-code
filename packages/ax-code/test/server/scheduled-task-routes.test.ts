import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { ScheduledTaskID, TaskQueueID } from "../../src/session/schema"
import { ScheduledTaskTable } from "../../src/session/session.sql"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
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
          status: "running",
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
        const start = vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await ScheduledTask.create({
          title: "Due GUI review",
          prompt: "Review the branch after the scheduler fires.",
          schedule: { type: "once", runAt: Date.now() + 20 },
        })

        try {
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
        } finally {
          start.mockRestore()
        }
      },
    })
  })

  test("scheduler normalizes non-finite poll intervals to the default", async () => {
    await using tmp = await tmpdir({ git: true })
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
    const unref = vi.fn()
    try {
      setIntervalSpy.mockImplementation((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
        if (typeof handler === "function") handler(...args)
        return { unref } as unknown as ReturnType<typeof setInterval>
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          ScheduledTask.initScheduler({ pollMs: Number.NaN })
        },
      })

      expect(setIntervalSpy).toHaveBeenCalled()
      expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(60_000)
      expect(unref).toHaveBeenCalledOnce()
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  test("records run-now queue metadata before dispatching detached work", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await ScheduledTask.create({
          title: "Manual queue ordering",
          prompt: "Record the queue relationship before execution starts.",
          schedule: { type: "once", runAt: Date.now() + 86_400_000 },
        })
        const start = vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => {
          expect((await ScheduledTask.get(task.id)).lastQueueID).toBe(item.id)
          return item
        })

        try {
          const result = await ScheduledTask.runNow(task.id)
          expect(result.task.lastQueueID).toBe(result.queueItem?.id)
        } finally {
          start.mockRestore()
        }
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
              workflowStartOptions: { enqueueChildren: "true", allowScaleBeyondDefaults: "false" },
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
            workflowRun: { id: string; status: string; sourceTemplateID: string; sourceTaskID: string }
            queueItem?: unknown
          }

          expect(runNow.queueItem).toBeUndefined()
          expect(runNow.workflowRun).toMatchObject({
            status: "completed",
            sourceTemplateID: "builtin:noop-dry-run",
            sourceTaskID: created.id,
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

  test("rejects schedules that can never fire with a 400", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
        const cases: Array<{ schedule: unknown; resource: string }> = [
          { schedule: { type: "daily", time: "99:99" }, resource: "schedule.time" },
          { schedule: { type: "weekly", day: 2, time: "24:00" }, resource: "schedule.time" },
          { schedule: { type: "cron", expression: "bad cron" }, resource: "schedule.cron" },
          { schedule: { type: "cron", expression: "0,,15 * * * *" }, resource: "schedule.cron" },
          { schedule: { type: "cron", expression: "0, * * * *" }, resource: "schedule.cron" },
          { schedule: { type: "daily", time: "09:00", timezone: "Not/AZone" }, resource: "schedule.timezone" },
        ]

        for (const { schedule, resource } of cases) {
          const response = await app.request(`/scheduled-task?${directoryQuery}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Bad schedule", prompt: "x", schedule }),
          })
          expect(response.status).toBe(400)
          const body = (await response.json()) as { name: string; details?: { resource?: string } }
          expect(body.name).toBe("InvalidRequestError")
          expect(body.details?.resource).toBe(resource)
        }

        // No invalid task should have been persisted.
        const list = (await (await app.request(`/scheduled-task?${directoryQuery}`)).json()) as unknown[]
        expect(list).toHaveLength(0)
      },
    })
  })

  test("rejects unsafe scheduled task timestamps", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const directoryQuery = `directory=${encodeURIComponent(tmp.path)}`
        const response = await app.request(`/scheduled-task?${directoryQuery}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Unsafe schedule",
            prompt: "x",
            schedule: { type: "once", runAt: Number.MAX_SAFE_INTEGER + 1 },
          }),
        })

        expect(response.status).toBe(400)
        const list = (await (await app.request(`/scheduled-task?${directoryQuery}`)).json()) as unknown[]
        expect(list).toHaveLength(0)
      },
    })
  })

  test("list skips corrupt persisted scheduled task rows", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const valid = await ScheduledTask.create({
          title: "Valid review",
          prompt: "Review the current branch.",
          schedule: { type: "once", runAt: Date.now() + 86_400_000 },
        })
        const now = Date.now()
        Database.use((db) => {
          db.insert(ScheduledTaskTable)
            .values({
              id: ScheduledTaskID.make("sch_corrupt_schedule"),
              project_id: Instance.project.id,
              directory: Instance.directory,
              title: "Corrupt schedule",
              prompt: "This row should be skipped.",
              schedule: { type: "daily" },
              status: "active",
              next_run_at: now,
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        expect((await ScheduledTask.list()).map((task) => task.id)).toEqual([valid.id])
      },
    })
  })

  test("concurrent run-due enqueues a due task only once", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const start = vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const runAt = Date.now() + 10
        const task = await ScheduledTask.create({
          title: "Due once",
          prompt: "Run exactly once even under concurrent ticks.",
          schedule: { type: "once", runAt },
        })

        try {
          const now = runAt + 1
          const [a, b] = await Promise.all([ScheduledTask.runDue(now), ScheduledTask.runDue(now)])
          const total = a.length + b.length
          expect(total).toBe(1)

          const queue = await TaskQueue.list()
          const forTask = queue.filter((item) => item.sourceTaskID === task.id)
          expect(forTask).toHaveLength(1)
        } finally {
          start.mockRestore()
        }
      },
    })
  })

  test("rolls back schedule advancement when durable queue insertion fails", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const runAt = Date.now() + 10
        const task = await ScheduledTask.create({
          title: "Atomic handoff",
          prompt: "Do not lose this occurrence.",
          schedule: { type: "once", runAt },
        })
        const enqueue = vi.spyOn(TaskQueue, "enqueueInTransaction").mockImplementation(() => {
          throw new Error("simulated queue insert failure")
        })

        try {
          await expect(ScheduledTask.runDue(runAt + 1)).rejects.toThrow("simulated queue insert failure")
          const refreshed = await ScheduledTask.get(task.id)
          expect(refreshed.nextRunAt).toBe(runAt)
          expect(refreshed.lastRunAt).toBeUndefined()
          expect(await TaskQueue.list()).toEqual([])
        } finally {
          enqueue.mockRestore()
        }
      },
    })
  })

  test("coalesces missed occurrences once and propagates the execution deadline", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const occurrenceAt = now - 10 * 60_000
        const task = await ScheduledTask.create({
          title: "Catch-up review",
          prompt: "Review after downtime.",
          schedule: { type: "daily", time: "09:00", timezone: "UTC" },
          catchUpPolicy: "run_once",
          maxRunDurationMs: 12_345,
        })
        Database.use((db) => {
          db.update(ScheduledTaskTable)
            .set({ next_run_at: occurrenceAt })
            .where(eq(ScheduledTaskTable.id, task.id))
            .run()
        })
        const start = vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)

        try {
          const result = await ScheduledTask.runDue(now)
          expect(result).toHaveLength(1)
          const [queueItem] = (await TaskQueue.list()).filter((item) => item.sourceTaskID === task.id)
          expect(queueItem).toMatchObject({
            executionTimeoutMs: 12_345,
            payload: {
              scheduledOccurrenceAt: occurrenceAt,
              scheduledReason: "scheduled",
            },
          })
          expect((await ScheduledTask.get(task.id)).nextRunAt).toBeGreaterThan(now)
        } finally {
          start.mockRestore()
        }
      },
    })
  })

  test("skips stale occurrences when catch-up policy is skip", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Skip stale review",
          prompt: "Only review on time.",
          schedule: { type: "daily", time: "09:00", timezone: "UTC" },
          catchUpPolicy: "skip",
        })
        Database.use((db) => {
          db.update(ScheduledTaskTable)
            .set({ next_run_at: now - 10 * 60_000 })
            .where(eq(ScheduledTaskTable.id, task.id))
            .run()
        })

        await expect(ScheduledTask.runDue(now)).resolves.toEqual([])
        expect(await TaskQueue.list()).toEqual([])
        const refreshed = await ScheduledTask.get(task.id)
        expect(refreshed.lastRunAt).toBeUndefined()
        expect(refreshed.nextRunAt).toBeGreaterThan(now)
      },
    })
  })

  test("run-due records workflow scheduled task failures", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    delete process.env.AX_CODE_WORKFLOW_RUNTIME
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const runAt = Date.now() + 1_000
          const task = await ScheduledTask.create({
            title: "Due workflow audit",
            prompt: "Run the saved workflow template.",
            schedule: { type: "once", runAt },
            workflowTemplateID: "builtin:noop-dry-run",
          })

          await expect(ScheduledTask.runDue(runAt + 1)).resolves.toHaveLength(1)

          const refreshed = await waitForValue(async () => {
            const candidate = await ScheduledTask.get(task.id)
            return candidate.error ? candidate : undefined
          })
          expect(refreshed.error).toContain("Workflow runtime is disabled")
          expect(refreshed.lastRunAt).toBeGreaterThan(0)
          expect(refreshed.nextRunAt).toBeUndefined()
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
