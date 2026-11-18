import { afterEach, expect, test, vi } from "vitest"
import { bootstrap } from "../../src/cli/bootstrap"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("a transient CLI instance leaves a due task for a persistent backend", async () => {
  await using tmp = await tmpdir({ git: true })
  const runAt = Date.now() + 1_000
  const task = await Instance.provide({
    directory: tmp.path,
    fn: () =>
      ScheduledTask.create({
        title: "Due after restart",
        prompt: "Check the build.",
        schedule: { type: "once", runAt },
      }),
  })
  await Instance.disposeAll()
  await new Promise((resolve) => setTimeout(resolve, 1_100))

  const started = vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
  await bootstrap(tmp.path, async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await ScheduledTask.listRuns({ taskID: task.id })).toEqual([])
    expect((await ScheduledTask.get(task.id)).nextRunAt).toBe(runAt)
  })
  expect(started).not.toHaveBeenCalled()

  await Instance.provide({
    directory: tmp.path,
    init: InstanceBootstrap,
    fn: async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        if ((await ScheduledTask.listRuns({ taskID: task.id })).length > 0) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const runs = await ScheduledTask.listRuns({ taskID: task.id })
      expect(runs).toHaveLength(1)
      expect(runs[0]?.status).toBe("running")
      expect(runs[0]?.queueID).toBeDefined()
      for (let attempt = 0; attempt < 20 && started.mock.calls.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(started).toHaveBeenCalledTimes(1)
    },
  })
})

test.each(["queued", "waiting_for_idle"] as const)(
  "a removed %s item does not block startup or recovery of the rest of the queue",
  async (status) => {
    await using tmp = await tmpdir({ git: true })
    const start = TaskQueueExecutor.start
    const started = vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const title of ["Removed during recovery", "Still queued"]) {
          const task = await ScheduledTask.create({
            title,
            prompt: "Check the build.",
            schedule: { type: "once", runAt: Date.now() + 60_000 },
          })
          const { queueItem } = await ScheduledTask.runNow(task.id)
          if (!queueItem) throw new Error("Expected a scheduled queue item")
          if (status === "waiting_for_idle") await TaskQueue.setStatus({ id: queueItem.id, status })
        }
      },
    })
    await Instance.disposeAll()

    let recoveryOrder: TaskQueue.Info["id"][]
    const removeFirst = async (items: TaskQueue.Info[]): Promise<void> => {
      expect(items).toHaveLength(2)
      recoveryOrder = items.map((item) => item.id)
      await TaskQueue.remove(recoveryOrder[0]!)
    }
    if (status === "queued") {
      const list = TaskQueue.listRestartableQueued
      vi.spyOn(TaskQueue, "listRestartableQueued").mockImplementationOnce(async () => {
        const items = await list()
        await removeFirst(items)
        return items
      })
    } else {
      const recover = TaskQueue.recoverInterrupted
      vi.spyOn(TaskQueue, "recoverInterrupted").mockImplementationOnce(async () => {
        const result = await recover()
        await removeFirst(result.requeued)
        return result
      })
    }

    const scheduler = vi.spyOn(ScheduledTask, "initScheduler").mockImplementation(() => {})
    started.mockClear().mockImplementation(async (item) => {
      if (item.id === recoveryOrder[0]) return start(item)
      const claim = await TaskQueue.claimForExecution(item.id)
      if (claim.kind !== "claimed") throw new Error("Expected the remaining item to be claimed")
      return claim.item
    })
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        expect(started.mock.calls.map(([item]) => item.id)).toEqual(recoveryOrder)
        expect(await TaskQueue.list()).toMatchObject([{ id: recoveryOrder[1], status: "running" }])
        expect(scheduler).toHaveBeenCalledTimes(1)
      },
    })
  },
)
