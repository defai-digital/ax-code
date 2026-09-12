import { afterEach, describe, expect, test, vi } from "vitest"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { NotificationEvent } from "../../src/notification/events"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import type { ScheduledTaskID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

type Toast = {
  title?: string
  message: string
  variant: "info" | "success" | "warning" | "error"
}

// PRD-2026-09-12: a one-time task is disabled only by a successful run.
// Failures retry under the bounded failure policy and eventually pause — all
// with user-visible toasts — instead of the task vanishing silently at claim.
describe("ScheduledTask one-shot lifecycle", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Instance.disposeAll()
  })

  function collectToasts() {
    const toasts: Toast[] = []
    const off = Bus.subscribe(NotificationEvent.ToastShow, (event) => {
      toasts.push(event.properties)
    })
    return { toasts, off }
  }

  async function flushEvents() {
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  }

  async function claimOnce(id: ScheduledTaskID, now: number) {
    const results = await ScheduledTask.runDue(now)
    const result = results.find((item) => item.task.id === id)
    if (!result) throw new Error("expected runDue to claim the one-shot task")
    return result
  }

  test("claim keeps a one-shot active with no next run; success disables it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const { toasts, off } = collectToasts()
        try {
          const now = Date.now()
          const task = await ScheduledTask.create({
            title: "Deploy reminder",
            prompt: "Check the deployment.",
            schedule: { type: "once", runAt: now + 1_000 },
          })

          const claimed = await claimOnce(task.id, now + 2_000)
          expect(claimed.queueItem).toBeDefined()

          const duringRun = await ScheduledTask.get(task.id)
          expect(duringRun.status).toBe("active")
          expect(duringRun.nextRunAt).toBeUndefined()

          await ScheduledTask.recordQueueOutcome(task.id, "completed", undefined, claimed.queueItem!.id)
          const completed = await ScheduledTask.get(task.id)
          expect(completed.status).toBe("disabled")
          expect(completed.nextRunAt).toBeUndefined()
          expect(completed.error).toBeUndefined()

          await flushEvents()
          expect(toasts.some((toast) => toast.title === "Scheduled task started" && toast.variant === "info")).toBe(
            true,
          )
          expect(
            toasts.some((toast) => toast.title === "Scheduled task completed" && toast.variant === "success"),
          ).toBe(true)

          const runs = await ScheduledTask.listRuns({ taskID: task.id })
          expect(runs.map((run) => run.status)).toEqual(["completed"])
        } finally {
          off()
        }
      },
    })
  })

  test("a failed one-shot stays active and retries with backoff; success after failures disables it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const { toasts, off } = collectToasts()
        try {
          const now = Date.now()
          const task = await ScheduledTask.create({
            title: "Fragile reminder",
            prompt: "Try and fail.",
            schedule: { type: "once", runAt: now + 1_000 },
          })

          const first = await claimOnce(task.id, now + 2_000)
          await ScheduledTask.recordQueueOutcome(task.id, "failed", new Error("boom"), first.queueItem!.id)

          const retry = await ScheduledTask.get(task.id)
          expect(retry.status).toBe("active")
          expect(retry.error).toContain("boom")
          expect(retry.nextRunAt).toBeGreaterThan(Date.now() + 50_000)
          expect(retry.nextRunAt).toBeLessThanOrEqual(Date.now() + 70_000)

          const second = await claimOnce(task.id, retry.nextRunAt! + 1)
          await ScheduledTask.recordQueueOutcome(task.id, "completed", undefined, second.queueItem!.id)

          const done = await ScheduledTask.get(task.id)
          expect(done.status).toBe("disabled")
          expect(done.error).toBeUndefined()

          await flushEvents()
          expect(
            toasts.some(
              (toast) =>
                toast.title === "Scheduled task failed" && toast.variant === "error" && /boom/.test(toast.message),
            ),
          ).toBe(true)
          expect(toasts.some((toast) => toast.title === "Scheduled task completed")).toBe(true)
        } finally {
          off()
        }
      },
    })
  })

  test("a one-shot pauses after five consecutive failures and notifies persistently", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const { toasts, off } = collectToasts()
        try {
          const now = Date.now()
          const task = await ScheduledTask.create({
            title: "Always failing reminder",
            prompt: "Fail forever.",
            schedule: { type: "once", runAt: now + 1_000 },
          })

          let dueAt = now + 2_000
          for (let failure = 1; failure <= ScheduledTask.MAX_CONSECUTIVE_FAILURES; failure++) {
            const claimed = await claimOnce(task.id, dueAt)
            await ScheduledTask.recordQueueOutcome(
              task.id,
              "failed",
              new Error(`boom ${failure}`),
              claimed.queueItem!.id,
            )
            const current = await ScheduledTask.get(task.id)
            if (failure < ScheduledTask.MAX_CONSECUTIVE_FAILURES) {
              expect(current.status).toBe("active")
              dueAt = current.nextRunAt! + 1
            }
          }

          const paused = await ScheduledTask.get(task.id)
          expect(paused.status).toBe("paused")
          expect(paused.error).toContain("auto-paused")

          await flushEvents()
          expect(toasts.some((toast) => toast.title === "Scheduled task paused" && toast.variant === "error")).toBe(
            true,
          )

          // A paused one-shot is evidence of failure, not a finished task: the
          // retention sweep must never prune it.
          expect(ScheduledTask.pruneFinishedOneShots(Date.now() + 365 * 24 * 60 * 60 * 1_000)).toBe(0)
        } finally {
          off()
        }
      },
    })
  })

  test("a failed manual run-now keeps the pending one-shot; a successful one disables it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Future reminder",
          prompt: "Run later.",
          schedule: { type: "once", runAt: now + 86_400_000 },
        })

        const failed = await ScheduledTask.runNow(task.id)
        await ScheduledTask.recordQueueOutcome(task.id, "failed", new Error("manual boom"), failed.queueItem!.id)
        const afterFailure = await ScheduledTask.get(task.id)
        expect(afterFailure.status).toBe("active")
        expect(afterFailure.nextRunAt).toBe(task.nextRunAt)

        const succeeded = await ScheduledTask.runNow(task.id)
        await ScheduledTask.recordQueueOutcome(task.id, "completed", undefined, succeeded.queueItem!.id)
        const afterSuccess = await ScheduledTask.get(task.id)
        expect(afterSuccess.status).toBe("disabled")
        expect(afterSuccess.nextRunAt).toBeUndefined()
      },
    })
  })

  test("an overlap skip re-arms a one-shot instead of disabling it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Keep the manual run in-flight so the due occurrence sees an open run.
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const { toasts, off } = collectToasts()
        try {
          const now = Date.now()
          const task = await ScheduledTask.create({
            title: "Overlapping reminder",
            prompt: "Collide.",
            schedule: { type: "once", runAt: now + 1_000 },
          })
          await ScheduledTask.runNow(task.id)

          await ScheduledTask.runDue(now + 2_000)

          const current = await ScheduledTask.get(task.id)
          expect(current.status).toBe("active")
          expect(current.nextRunAt).toBeGreaterThan(now + 2_000)

          const runs = await ScheduledTask.listRuns({ taskID: task.id })
          expect(runs.some((run) => run.status === "skipped_overlap")).toBe(true)

          await flushEvents()
          expect(toasts.some((toast) => toast.title === "Scheduled task skipped" && toast.variant === "warning")).toBe(
            true,
          )
        } finally {
          off()
        }
      },
    })
  })

  test("recurring tasks are unaffected by the one-shot completion rule", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await ScheduledTask.create({
          title: "Hourly check",
          prompt: "Recur.",
          schedule: { type: "cron", expression: "7 * * * *" },
        })
        const due = await ScheduledTask.get(task.id)
        // Recurring fires wait out their deterministic jitter (capped at 3
        // minutes, inside the 5-minute missed grace), so poll just past it.
        const claimed = await claimOnce(task.id, due.nextRunAt! + 3 * 60 * 1_000 + 1)
        await ScheduledTask.recordQueueOutcome(task.id, "completed", undefined, claimed.queueItem!.id)

        const current = await ScheduledTask.get(task.id)
        expect(current.status).toBe("active")
        expect(current.nextRunAt).toBeGreaterThan(due.nextRunAt!)
      },
    })
  })
})
