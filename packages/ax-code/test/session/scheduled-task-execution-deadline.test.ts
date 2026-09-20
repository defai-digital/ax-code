import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { tmpdir } from "../fixture/fixture"

// 2026-09-20: the queue item for a scheduled run must carry the same
// execution deadline the scheduler's overlap/orphan accounting uses
// (maxRunDurationMs ?? DEFAULT_RUN_DEADLINE_MS, 30 minutes). Leaving it unset
// dropped the executor to its 72h global fallback, so a run still executing
// past deadline+grace was mislabeled orphaned and the next due occurrence
// double-fired while the late outcome could no longer find its run row.
const DEFAULT_RUN_DEADLINE_MS = 30 * 60 * 1_000

describe("ScheduledTask execution deadline", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Instance.disposeAll()
  })

  test("a scheduled fire without maxRunDurationMs enforces the 30-minute default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const now = Date.now()
        const task = await ScheduledTask.create({
          title: "Default deadline",
          prompt: "Run with the default deadline.",
          schedule: { type: "once", runAt: now + 1_000 },
        })
        const results = await ScheduledTask.runDue(now + 2_000)
        const result = results.find((item) => item.task.id === task.id)
        expect(result?.queueItem?.executionTimeoutMs).toBe(DEFAULT_RUN_DEADLINE_MS)
      },
    })
  })

  test("a manual run-now without maxRunDurationMs enforces the 30-minute default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await ScheduledTask.create({
          title: "Manual default deadline",
          prompt: "Run now with the default deadline.",
          schedule: { type: "daily", time: "09:00" },
        })
        const result = await ScheduledTask.runNow(task.id)
        expect(result.queueItem?.executionTimeoutMs).toBe(DEFAULT_RUN_DEADLINE_MS)
      },
    })
  })

  test("an explicit maxRunDurationMs still overrides the default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await ScheduledTask.create({
          title: "Custom deadline",
          prompt: "Run with a custom deadline.",
          schedule: { type: "daily", time: "09:00" },
          maxRunDurationMs: 42 * 60 * 1_000,
        })
        const result = await ScheduledTask.runNow(task.id)
        expect(result.queueItem?.executionTimeoutMs).toBe(42 * 60 * 1_000)
      },
    })
  })
})
