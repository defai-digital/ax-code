import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueueID } from "../../src/session/schema"
import { ScheduledTaskRunTable } from "../../src/session/session.sql"
import { SessionShard } from "../../src/session/shard"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { TaskQueue } from "../../src/session/task-queue"
import { eq } from "../../src/storage/db"
import { WorkflowRun, WorkflowScheduler, WorkflowTemplate } from "../../src/workflow"
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

  // 2026-09-20 follow-up: the queue-item deadline bounds the dispatch, not the
  // workflow. A workflow still executing past deadline+grace must not be
  // orphaned by reconcileOrphanRuns — that used to open overlap protection and
  // double-fire the next occurrence while the live workflow's outcome could no
  // longer find its row.
  test("an in-flight workflow past deadline+grace is not orphaned and still blocks a second dispatch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
        process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
        try {
          // The workflow never progresses in this test: its run stays
          // non-terminal for as long as it needs to.
          vi.spyOn(WorkflowScheduler, "start").mockResolvedValue({ status: "running" } as never)
          const deadline = 1_000
          const grace = 10 * 60 * 1_000
          const now = Date.now()
          const task = await ScheduledTask.create({
            title: "Long workflow",
            prompt: "Run the workflow.",
            schedule: { type: "cron", expression: "*/5 * * * *" },
            workflowTemplateID: "builtin:noop-dry-run",
            maxRunDurationMs: deadline,
          })
          const first = await ScheduledTask.runNow(task.id)
          expect(first.workflowRun).toBeDefined()

          // Mark the workflow as executing: a queued-forever run is
          // abandoned, not live (restart recovery only sweeps running runs).
          const [createdRun] = await WorkflowRun.list()
          await WorkflowRun.setStatus({ id: createdRun!.id, status: "running" })

          // Backdate the dispatch row instead of waiting out the real clock.
          const staleAt = now - (deadline + grace + 1)
          SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
            db.update(ScheduledTaskRunTable)
              .set({ time_started: staleAt, time_updated: staleAt })
              .where(eq(ScheduledTaskRunTable.task_id, task.id))
              .run()
          })

          await expect(ScheduledTask.runNow(task.id)).rejects.toMatchObject({ status: 409 })
          const runs = await ScheduledTask.listRuns({ taskID: task.id })
          expect(runs.filter((run) => run.status === "running")).toHaveLength(1)
          const workflowRuns = await WorkflowRun.list()
          expect(workflowRuns).toHaveLength(1)

          // A workflow that ended leaves the row genuinely orphaned: the sweep
          // still applies and the next run-now dispatches again.
          await WorkflowRun.setStatus({ id: workflowRuns[0]!.id, status: "cancelled" })
          await expect(ScheduledTask.runNow(task.id)).resolves.toBeDefined()
          expect(await WorkflowRun.list()).toHaveLength(2)
        } finally {
          if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
          else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
        }
      },
    })
  })

  test("a queued-forever workflow run is abandoned, so the sweep still wedges nothing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
        process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
        try {
          // start is mocked away: the workflow run stays `queued` — the state
          // left behind when the backend dies between createRun and start.
          vi.spyOn(WorkflowScheduler, "start").mockResolvedValue({ status: "running" } as never)
          const deadline = 1_000
          const grace = 10 * 60 * 1_000
          const now = Date.now()
          const task = await ScheduledTask.create({
            title: "Abandoned workflow",
            prompt: "Run the workflow.",
            schedule: { type: "cron", expression: "*/5 * * * *" },
            workflowTemplateID: "builtin:noop-dry-run",
            maxRunDurationMs: deadline,
          })
          await ScheduledTask.runNow(task.id)

          const staleAt = now - (deadline + grace + 1)
          SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
            db.update(ScheduledTaskRunTable)
              .set({ time_started: staleAt, time_updated: staleAt })
              .where(eq(ScheduledTaskRunTable.task_id, task.id))
              .run()
          })

          // The abandoned dispatch row is orphaned and the next run-now fires.
          await expect(ScheduledTask.runNow(task.id)).resolves.toBeDefined()
          const runs = await ScheduledTask.listRuns({ taskID: task.id })
          expect(runs.some((run) => run.status === "failed" && (run.error ?? "").startsWith("orphaned:"))).toBe(true)
          expect(runs.filter((run) => run.status === "running")).toHaveLength(1)
        } finally {
          if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
          else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
        }
      },
    })
  })

  // The tests above drive run-now, which stamps the dispatch row's workflow id
  // at claim time. A scheduler tick instead creates the row at claim and only
  // learns the workflow id later, when the executor reports it through
  // recordWorkflowRun. hasOpenRunIn and reconcileOrphanRuns read the ROW, so
  // without that link a tick-dispatched workflow older than deadline+grace was
  // orphaned and the next occurrence double-fired.
  test("a tick-dispatched workflow keeps its run row open past deadline+grace", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
        process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
        try {
          // The executor's queue dispatch is stubbed, so the workflow run is
          // reported explicitly below the way that path reports it.
          vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
          const deadline = 1_000
          const grace = 10 * 60 * 1_000
          const task = await ScheduledTask.create({
            title: "Tick workflow",
            prompt: "Run the workflow.",
            schedule: { type: "cron", expression: "* * * * *" },
            workflowTemplateID: "builtin:noop-dry-run",
            maxRunDurationMs: deadline,
          })
          // Fire past the missed-run grace so the anti-herd jitter does not
          // defer the occurrence; catchUpPolicy run_once still runs it.
          const firstDueAt = (task.nextRunAt ?? Date.now()) + 6 * 60 * 1_000
          const first = await ScheduledTask.runDue(firstDueAt)
          expect(first.some((result) => result.task.id === task.id)).toBe(true)

          const workflowRun = await WorkflowTemplate.createRun({
            templateID: "builtin:noop-dry-run",
            sourceTaskID: task.id,
          })
          await WorkflowRun.setStatus({ id: workflowRun.id, status: "running" })
          await ScheduledTask.recordWorkflowRun(task.id, workflowRun.id)

          // Backdate the dispatch row past deadline+grace instead of waiting.
          const next = await ScheduledTask.get(task.id)
          const secondDueAt = (next.nextRunAt ?? firstDueAt) + 6 * 60 * 1_000
          const staleAt = secondDueAt - (deadline + grace + 1)
          SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
            db.update(ScheduledTaskRunTable)
              .set({ time_started: staleAt, time_updated: staleAt })
              .where(eq(ScheduledTaskRunTable.task_id, task.id))
              .run()
          })

          // The live workflow keeps the row open: this occurrence is skipped as
          // an overlap, not dispatched a second time, and the row is not
          // orphaned.
          const second = await ScheduledTask.runDue(secondDueAt)
          expect(second.some((result) => result.task.id === task.id)).toBe(false)
          const runs = await ScheduledTask.listRuns({ taskID: task.id })
          expect(runs.filter((run) => run.status === "running")).toHaveLength(1)
          expect(runs.some((run) => (run.error ?? "").startsWith("orphaned:"))).toBe(false)
          expect(await WorkflowRun.list()).toHaveLength(1)
        } finally {
          if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
          else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
        }
      },
    })
  })

  test("a queued task past deadline+grace is not orphaned or dispatched twice", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const deadline = 1_000
        const grace = 10 * 60 * 1_000
        const task = await ScheduledTask.create({
          title: "Queued task",
          prompt: "Run the scheduled task.",
          schedule: { type: "cron", expression: "* * * * *" },
          maxRunDurationMs: deadline,
        })
        const firstDueAt = (task.nextRunAt ?? Date.now()) + 6 * 60 * 1_000
        const first = await ScheduledTask.runDue(firstDueAt)
        expect(first).toHaveLength(1)

        const [firstRun] = await ScheduledTask.listRuns({ taskID: task.id })
        expect(firstRun?.queueID).toBeDefined()
        const queueItem = await TaskQueue.get(TaskQueueID.make(firstRun!.queueID!))
        expect(queueItem.status).toBe("queued")

        const next = await ScheduledTask.get(task.id)
        const secondDueAt = (next.nextRunAt ?? firstDueAt) + 6 * 60 * 1_000
        const staleAt = secondDueAt - (deadline + grace + 1)
        SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
          db.update(ScheduledTaskRunTable)
            .set({ time_started: staleAt, time_updated: staleAt })
            .where(eq(ScheduledTaskRunTable.queue_id, queueItem!.id))
            .run()
        })
        const second = await ScheduledTask.runDue(secondDueAt)
        expect(second).toHaveLength(0)
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.filter((run) => run.status === "running")).toHaveLength(1)
        expect(runs.some((run) => run.status === "failed" && (run.error ?? "").startsWith("orphaned:"))).toBe(false)
        expect(runs.some((run) => run.status === "skipped_overlap")).toBe(true)
      },
    })
  })
})
