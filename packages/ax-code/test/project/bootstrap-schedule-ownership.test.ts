import { afterEach, expect, test, vi } from "vitest"
import { bootstrap } from "../../src/cli/bootstrap"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Instance } from "../../src/project/instance"
import { ScheduledTask } from "../../src/session/scheduled-task"
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
