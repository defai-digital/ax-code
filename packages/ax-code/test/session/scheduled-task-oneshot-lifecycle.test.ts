import { afterEach, describe, expect, test, vi } from "vitest"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { NotificationEvent } from "../../src/notification/events"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import type { ScheduledTaskID } from "../../src/session/schema"
import { ScheduledTaskTable, TaskQueueTable } from "../../src/session/session.sql"
import { SessionShard } from "../../src/session/shard"
import { TaskQueue } from "../../src/session/task-queue"
import { NotFoundError, eq } from "../../src/storage/db"
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

  test.each(["completed", "failed"] as const)(
    "a conflicting callback cannot overwrite a %s one-shot outcome",
    async (firstStatus) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
          const now = Date.now()
          const task = await ScheduledTask.create({
            title: "Duplicate outcome",
            prompt: "Run once.",
            schedule: { type: "once", runAt: now + 1_000 },
          })
          const claimed = await claimOnce(task.id, now + 2_000)
          const queueID = claimed.queueItem!.id
          await ScheduledTask.recordQueueOutcome(task.id, firstStatus, new Error("original failure"), queueID)
          const settled = await ScheduledTask.get(task.id)
          const runs = await ScheduledTask.listRuns({ taskID: task.id })

          await ScheduledTask.recordQueueOutcome(
            task.id,
            firstStatus === "completed" ? "failed" : "completed",
            new Error("late conflicting outcome"),
            queueID,
          )

          expect(await ScheduledTask.get(task.id)).toEqual(settled)
          expect(await ScheduledTask.listRuns({ taskID: task.id })).toEqual(runs)
        },
      })
    },
  )

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

  test("resuming an auto-paused recurring task clears the failure error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await ScheduledTask.create({
          title: "Always failing cron",
          prompt: "Fail forever.",
          schedule: { type: "cron", expression: "0 * * * *" },
        })

        let dueAt = (await ScheduledTask.get(task.id)).nextRunAt! + 4 * 60_000
        for (let failure = 1; failure <= ScheduledTask.MAX_CONSECUTIVE_FAILURES; failure++) {
          const claimed = await claimOnce(task.id, dueAt)
          await ScheduledTask.recordQueueOutcome(task.id, "failed", new Error(`boom ${failure}`), claimed.queueItem!.id)
          const current = await ScheduledTask.get(task.id)
          if (failure < ScheduledTask.MAX_CONSECUTIVE_FAILURES) dueAt = current.nextRunAt! + 4 * 60_000
        }

        const paused = await ScheduledTask.get(task.id)
        expect(paused.status).toBe("paused")
        expect(paused.error).toContain("auto-paused")

        // Resume clears the failure (SPEC §7) so the UI stops showing a
        // recovered task as failed until its next claim.
        const resumed = await ScheduledTask.resume(task.id)
        expect(resumed.status).toBe("active")
        expect(resumed.error).toBeUndefined()
      },
    })
  })

  test("orphaned runs do not count toward the consecutive-failure auto-pause", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        try {
          const now = Date.now()
          const task = await ScheduledTask.create({
            title: "Restart-plagued reminder",
            prompt: "Keep going.",
            schedule: { type: "once", runAt: now + 1_000 },
          })

          // Repeated backend restarts orphan the run (the orphan sweep's
          // marker). Infrastructure failures are not task failures: the task
          // must keep retrying instead of auto-pausing at the cap.
          let dueAt = now + 2_000
          for (let i = 1; i <= ScheduledTask.MAX_CONSECUTIVE_FAILURES; i++) {
            const claimed = await claimOnce(task.id, dueAt)
            await ScheduledTask.recordQueueOutcome(
              task.id,
              "failed",
              new Error("orphaned: no outcome was recorded (backend likely restarted)"),
              claimed.queueItem!.id,
            )
            const current = await ScheduledTask.get(task.id)
            expect(current.status).toBe("active")
            dueAt = current.nextRunAt! + 1
          }
        } finally {
          vi.restoreAllMocks()
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

  test("a failed one-shot with catch-up skip still fires a late retry instead of being disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Skip-policy reminder",
          prompt: "Retry me.",
          schedule: { type: "once", runAt: now + 1_000 },
          catchUpPolicy: "skip",
        })

        const first = await claimOnce(task.id, now + 2_000)
        await ScheduledTask.recordQueueOutcome(task.id, "failed", new Error("boom"), first.queueItem!.id)
        const retry = await ScheduledTask.get(task.id)
        expect(retry.status).toBe("active")
        const retryAt = retry.nextRunAt!
        if (retry.schedule.type !== "once") throw new Error("expected a one-time schedule")
        expect(retryAt).toBeGreaterThan(retry.schedule.runAt)

        // The backoff due time passes without a scheduler tick (backend outage
        // longer than the missed grace). The skip policy governs missed
        // CALENDAR occurrences; a failure-policy retry is not one, so the task
        // must still fire rather than being disabled as missed.
        const results = await ScheduledTask.runDue(retryAt + 6 * 60_000)
        expect(results.some((item) => item.task.id === task.id)).toBe(true)

        const after = await ScheduledTask.get(task.id)
        expect(after.status).toBe("active")
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.some((run) => run.status === "missed_skip")).toBe(false)
        expect(runs.filter((run) => run.status === "running")).toHaveLength(1)
      },
    })
  })

  test("a never-fired one-shot with catch-up skip is still disabled after a missed occurrence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Missed reminder",
          prompt: "Only on time.",
          schedule: { type: "once", runAt: now + 1_000 },
          catchUpPolicy: "skip",
        })

        const results = await ScheduledTask.runDue(now + 10 * 60_000)
        expect(results.some((item) => item.task.id === task.id)).toBe(false)

        const after = await ScheduledTask.get(task.id)
        expect(after.status).toBe("disabled")
        expect(after.nextRunAt).toBeUndefined()
        expect(after.lastRunAt).toBeDefined()
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.some((run) => run.status === "missed_skip")).toBe(true)

        // The disabled row stamped last_run_at, so the retention sweep
        // reclaims it once the one-shot retention window passes. Without the
        // stamp the NULL last_run_at never satisfies the lte cutoff and the
        // row would leak past every sweep.
        expect(ScheduledTask.pruneFinishedOneShots(now + 91 * 24 * 60 * 60 * 1_000)).toBe(1)
        await expect(ScheduledTask.get(task.id)).rejects.toThrow(NotFoundError)
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

  test("a fired one-shot can be resumed when the same update supplies a new future schedule", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "One-time reminder",
          prompt: "Ping once.",
          schedule: { type: "once", runAt: now + 1_000 },
        })
        const claimed = await claimOnce(task.id, now + 2_000)
        await ScheduledTask.recordQueueOutcome(task.id, "completed", undefined, claimed.queueItem!.id)
        expect((await ScheduledTask.get(task.id)).status).toBe("disabled")

        // Move the persisted schedule into the real past: the resume guard
        // compares runAt against the wall clock, and the simulated claim above
        // leaves runAt a second in the future.
        SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
          db.update(ScheduledTaskTable)
            .set({ schedule: { type: "once", runAt: now - 60_000 } })
            .where(eq(ScheduledTaskTable.id, task.id))
            .run()
        })

        // Resuming against the OLD (now-past) schedule stays rejected.
        await expect(ScheduledTask.resume(task.id)).rejects.toThrow(/already ran/)

        // The same request carrying a new future schedule is valid: the guard
        // must evaluate the incoming schedule, not the consumed one.
        const revived = await ScheduledTask.update({
          id: task.id,
          status: "active",
          schedule: { type: "once", runAt: now + 3_600_000 },
        })
        expect(revived.status).toBe("active")
        expect(revived.nextRunAt).toBe(now + 3_600_000)
      },
    })
  })

  test("a new schedule alone re-arms a fired one-shot; an explicit status in the same request wins", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "One-time reminder",
          prompt: "Ping once.",
          schedule: { type: "once", runAt: now + 1_000 },
        })
        const claimed = await claimOnce(task.id, now + 2_000)
        await ScheduledTask.recordQueueOutcome(task.id, "completed", undefined, claimed.queueItem!.id)
        expect((await ScheduledTask.get(task.id)).status).toBe("disabled")

        // A prompt edit leaves the finished task finished.
        const edited = await ScheduledTask.update({ id: task.id, prompt: "Ping once, politely." })
        expect(edited.status).toBe("disabled")
        expect(edited.nextRunAt).toBeUndefined()

        // Regression: a new schedule without a status stored the schedule and
        // next_run_at on a row that stayed disabled, so it looked scheduled while
        // runDue never listed it.
        const rearmed = await ScheduledTask.update({
          id: task.id,
          schedule: { type: "once", runAt: now + 3_600_000 },
        })
        expect(rearmed.status).toBe("active")
        expect(rearmed.nextRunAt).toBe(now + 3_600_000)
        expect(rearmed.error).toBeUndefined()
        expect((await ScheduledTask.list({ status: "active" })).map((item) => item.id)).toEqual([task.id])

        // Finish it a second time, then re-schedule it paused: the explicit status is kept.
        const second = await claimOnce(task.id, now + 3_600_000 + 1_000)
        await ScheduledTask.recordQueueOutcome(task.id, "completed", undefined, second.queueItem!.id)
        expect((await ScheduledTask.get(task.id)).status).toBe("disabled")
        const parked = await ScheduledTask.update({
          id: task.id,
          status: "paused",
          schedule: { type: "once", runAt: now + 7_200_000 },
        })
        expect(parked.status).toBe("paused")
        expect(parked.nextRunAt).toBe(now + 7_200_000)
        const resumed = await ScheduledTask.resume(task.id)
        expect(resumed.status).toBe("active")
        expect(resumed.nextRunAt).toBe(now + 7_200_000)
      },
    })
  })

  test("resuming an expired one-shot explains how it was paused", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Expiring reminder",
          prompt: "Ping once.",
          schedule: { type: "once", runAt: now + 60_000 },
        })
        await ScheduledTask.pause(task.id)
        const clock = vi.spyOn(Date, "now").mockReturnValue(now + 120_000)
        try {
          // Paused by the user: nothing failed, the run time simply passed.
          await expect(ScheduledTask.resume(task.id)).rejects.toThrow(/run time passed while it was paused/)

          // Paused by the failure policy: the retry path is run-now.
          SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
            db.update(ScheduledTaskTable)
              .set({ error: "auto-paused after 5 consecutive failures: model exploded" })
              .where(eq(ScheduledTaskTable.id, task.id))
              .run()
          })
          await expect(ScheduledTask.resume(task.id)).rejects.toThrow(/paused after repeated failures/)
        } finally {
          clock.mockRestore()
        }
      },
    })
  })

  test("maxRunDurationMs cannot change while a run is in progress", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await ScheduledTask.create({
          title: "Long runner",
          prompt: "Run long.",
          schedule: { type: "once", runAt: Date.now() + 60_000 },
          maxRunDurationMs: 3_600_000,
        })
        await ScheduledTask.runNow(task.id)

        // Shrinking mid-run would let the orphan sweep mislabel the live run
        // and admit a second concurrent execution.
        await expect(ScheduledTask.update({ id: task.id, maxRunDurationMs: 60_000 })).rejects.toThrow(/in progress/)

        // Re-saving the same value is a no-op and stays allowed.
        const noop = await ScheduledTask.update({ id: task.id, maxRunDurationMs: 3_600_000 })
        expect(noop.maxRunDurationMs).toBe(3_600_000)

        // Unrelated edits are unaffected.
        const renamed = await ScheduledTask.update({ id: task.id, title: "Renamed" })
        expect(renamed.title).toBe("Renamed")
      },
    })
  })
  test("a new schedule alone does not re-arm a recurring task a client disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await ScheduledTask.create({
          title: "Nightly digest",
          prompt: "Summarize.",
          schedule: { type: "daily", time: "09:00", timezone: "UTC" },
        })
        const disabled = await ScheduledTask.update({ id: task.id, status: "disabled" })
        expect(disabled.status).toBe("disabled")

        // Only a finished one-shot is re-armed by a schedule. A client that
        // echoes or edits the schedule on an unrelated save must not switch a
        // recurring task back on; that takes an explicit status.
        const edited = await ScheduledTask.update({
          id: task.id,
          schedule: { type: "daily", time: "10:00", timezone: "UTC" },
        })
        expect(edited.status).toBe("disabled")
        expect(edited.schedule).toEqual({ type: "daily", time: "10:00", timezone: "UTC" })

        const resumed = await ScheduledTask.update({ id: task.id, status: "active" })
        expect(resumed.status).toBe("active")
        expect(resumed.nextRunAt).toBeDefined()
      },
    })
  })

  test("a finished one-shot cannot be paused without a new schedule", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Deploy reminder",
          prompt: "Check the deployment.",
          schedule: { type: "once", runAt: now + 1_000 },
        })
        const claimed = await claimOnce(task.id, now + 2_000)
        await ScheduledTask.recordQueueOutcome(task.id, "completed", undefined, claimed.queueItem!.id)
        expect((await ScheduledTask.get(task.id)).status).toBe("disabled")

        // There is nothing to pause: the task is not running and will not run
        // again. A paused row would later be resumed with a misleading message.
        await expect(ScheduledTask.pause(task.id)).rejects.toThrow(/cannot be paused/)
        await expect(ScheduledTask.update({ id: task.id, status: "paused" })).rejects.toThrow(/cannot be paused/)
        expect((await ScheduledTask.get(task.id)).status).toBe("disabled")

        // Parking it paused together with a new schedule stays legal.
        const parked = await ScheduledTask.update({
          id: task.id,
          status: "paused",
          schedule: { type: "once", runAt: now + 3_600_000 },
        })
        expect(parked.status).toBe("paused")
      },
    })
  })

  test("a run-now that fails before claiming a run still records a failed run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await ScheduledTask.create({
          title: "Deploy reminder",
          prompt: "Check the deployment.",
          schedule: { type: "once", runAt: Date.now() + 60_000 },
        })
        vi.spyOn(TaskQueue, "enqueueInTransaction").mockImplementation(() => {
          throw new Error("queue unavailable")
        })
        await expect(ScheduledTask.runNow(task.id)).rejects.toThrow(/queue unavailable/)

        // The attempt is in the history, not only on the task summary, so a
        // client that reads the latest run sees the failure the row reports.
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs).toHaveLength(1)
        expect(runs[0]).toMatchObject({ triggerType: "manual", status: "failed", error: "queue unavailable" })
        expect(runs[0].timeCompleted).toBeDefined()
        const current = await ScheduledTask.get(task.id)
        expect(current.error).toBe("queue unavailable")
        expect(current.lastRunAt).toBeDefined()
        // One dispatch failure is far below the auto-pause cap.
        expect(current.status).toBe("active")
      },
    })
  })

  test("the scheduler sweep closes an orphaned run of a paused task and announces it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Deploy reminder",
          prompt: "Check the deployment.",
          schedule: { type: "once", runAt: now + 1_000 },
        })
        const claimed = await claimOnce(task.id, now + 2_000)
        await ScheduledTask.pause(task.id)
        // The queue item finished but its outcome callback never arrived (a
        // restart in the gap). The queue's own restart recovery skips a
        // terminal item, and a paused task is never due and never run-now'd
        // by the scheduler, so only the sweep can close the row.
        SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
          db.update(TaskQueueTable)
            .set({ status: "completed" })
            .where(eq(TaskQueueTable.id, claimed.queueItem!.id))
            .run()
        })
        const updated: string[] = []
        const off = Bus.subscribe(ScheduledTask.Event.Updated, (event) => {
          updated.push(event.properties.task.id)
        })
        try {
          // Inside deadline + grace the run may still be live: left alone.
          await ScheduledTask.reconcileAllOrphanRuns(now + 2_000 + 60_000)
          expect((await ScheduledTask.listRuns({ taskID: task.id }))[0].status).toBe("running")

          await ScheduledTask.reconcileAllOrphanRuns(now + 2_000 + 30 * 60_000 + 10 * 60_000 + 1)
          await flushEvents()
          const runs = await ScheduledTask.listRuns({ taskID: task.id })
          expect(runs[0].status).toBe("failed")
          expect(runs[0].error).toMatch(/^orphaned:/)
          expect(updated).toContain(task.id)
          // Orphans are infrastructure failures: the task stays paused by the
          // user, with no failure-policy note.
          const current = await ScheduledTask.get(task.id)
          expect(current.status).toBe("paused")
          expect(current.error).toBeUndefined()
        } finally {
          off()
        }
      },
    })
  })

  test("a deleted event names the task's directory and nothing else of the task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await ScheduledTask.create({
          title: "Deploy reminder",
          prompt: "Check the deployment.",
          schedule: { type: "once", runAt: Date.now() + 60_000 },
        })
        const deleted: unknown[] = []
        const off = Bus.subscribe(ScheduledTask.Event.Deleted, (event) => {
          deleted.push(event.properties)
        })
        try {
          expect(await ScheduledTask.remove(task.id)).toBe(true)
          await flushEvents()
        } finally {
          off()
        }
        expect(deleted).toEqual([{ id: task.id, projectID: task.projectID, directory: task.directory }])
      },
    })
  })
})
