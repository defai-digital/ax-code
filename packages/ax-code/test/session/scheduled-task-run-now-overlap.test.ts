import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { tmpdir } from "../fixture/fixture"

// 2026-09-14: run-now overlap protection. The cheap hasOpenRun pre-check in
// runNow used to be the ONLY check, and the run row was inserted after an
// await boundary — a scheduler tick (or a second run-now) could pass the same
// check in the gap and double-fire the occurrence. The authoritative guard
// now runs inside the claim transaction on both the manual and the tick path.
describe("ScheduledTask run-now overlap protection", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Instance.disposeAll()
  })

  test("concurrent run-now claims admit exactly one run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Race probe",
          prompt: "Do the thing once.",
          schedule: { type: "once", runAt: now + 60_000 },
        })
        const settled = await Promise.allSettled([ScheduledTask.runNow(task.id), ScheduledTask.runNow(task.id)])
        expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1)
        const rejected = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined
        expect(rejected?.reason).toMatchObject({ status: 409 })
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.filter((run) => run.status === "running")).toHaveLength(1)
      },
    })
  })

  test("run-now racing the scheduler tick admits exactly one run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        // Create requires a future runAt; the tick is evaluated at a simulated
        // time past MISSED_RUN_GRACE_MS so the anti-herd jitter gate cannot
        // make the race outcome depend on wall-clock jitter.
        const task = await ScheduledTask.create({
          title: "Tick race",
          prompt: "Do the due thing.",
          schedule: { type: "once", runAt: now + 1_000 },
        })
        const dueAt = now + 6 * 60_000
        const [manual, tick] = await Promise.allSettled([ScheduledTask.runNow(task.id), ScheduledTask.runDue(dueAt)])
        const admitted = (manual.status === "fulfilled" ? 1 : 0) + (tick.status === "fulfilled" ? tick.value.length : 0)
        expect(admitted).toBe(1)
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.filter((run) => run.status === "running")).toHaveLength(1)
      },
    })
  })

  test("run-now dispatch failure finalizes the run row instead of wedging overlap", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockRejectedValue(new Error("boom dispatch"))
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Dispatch failure",
          prompt: "Fail loudly.",
          schedule: { type: "once", runAt: now + 60_000 },
        })
        await expect(ScheduledTask.runNow(task.id)).rejects.toThrow("boom dispatch")
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.filter((run) => run.status === "running")).toHaveLength(0)
        expect(runs.some((run) => run.status === "failed" && (run.error ?? "").includes("boom dispatch"))).toBe(true)

        // The wedged-run regression: the next run-now must not be blocked by
        // overlap protection for deadline+grace.
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const second = await ScheduledTask.runNow(task.id)
        expect(second.queueItem).toBeDefined()
      },
    })
  })

  test("delete stops the in-flight run instead of letting it execute to completion", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Disposable",
          prompt: "Run me.",
          schedule: { type: "once", runAt: now + 60_000 },
        })
        const { queueItem } = await ScheduledTask.runNow(task.id)
        expect(queueItem).toBeDefined()

        await ScheduledTask.remove(task.id)

        await expect(ScheduledTask.get(task.id)).rejects.toThrow()
        expect((await TaskQueue.get(queueItem!.id)).status).toBe("cancelled")
      },
    })
  })

  test("a one-time occurrence blocked by an open run records one skipped_overlap, not one per poll", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Reminder",
          prompt: "Ping.",
          schedule: { type: "once", runAt: now + 60_000 },
        })
        // A manual run is still in progress when the scheduled occurrence comes
        // due: run-now never advances next_run_at, so the tick keeps seeing it.
        await ScheduledTask.runNow(task.id)

        await ScheduledTask.runDue(now + 120_000)
        let runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.filter((run) => run.status === "skipped_overlap")).toHaveLength(1)

        // Every poll while the same run stays open re-arms the one-shot; the
        // repeat skips must collapse instead of flooding run history.
        await ScheduledTask.runDue(now + 120_000 + 2 * 60_000)
        await ScheduledTask.runDue(now + 120_000 + 4 * 60_000)
        runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.filter((run) => run.status === "skipped_overlap")).toHaveLength(1)
        expect(runs.filter((run) => run.status === "running")).toHaveLength(1)
      },
    })
  })
})
