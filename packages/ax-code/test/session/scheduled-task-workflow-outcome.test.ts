import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { ScheduledTaskRunID, type ScheduledTaskID } from "../../src/session/schema"
import { ScheduledTaskRunTable, ScheduledTaskTable } from "../../src/session/session.sql"
import { SessionShard } from "../../src/session/shard"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { and, eq } from "../../src/storage/db"
import { WorkflowRun, WorkflowScheduler, WorkflowTemplate } from "../../src/workflow"
import { WorkflowRunID } from "../../src/workflow/state"
import { tmpdir } from "../fixture/fixture"

// The workflow bridge re-reports a terminal run's outcome on every later
// sibling sync (WorkflowTaskQueue.syncItem). Each recordWorkflowOutcome call
// must record the outcome at most once: a repeat must not re-apply the failure
// policy (which would push next_run_at further out every time), while a real
// outcome arriving after the orphan sweep must still apply it exactly once.
describe("ScheduledTask workflow outcome recording", () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Instance.disposeAll()
    vi.unstubAllEnvs()
  })

  async function mockWorkflowDispatch(workflowRunID: string) {
    const createRun = vi.spyOn(WorkflowTemplate, "createRun").mockResolvedValue({ id: workflowRunID } as never)
    const start = vi.spyOn(WorkflowScheduler, "start").mockResolvedValue({ status: "running" } as never)
    return { createRun, start }
  }

  async function createWorkflowTask() {
    return ScheduledTask.create({
      title: "Workflow outcome",
      prompt: "Run the workflow.",
      schedule: { type: "cron", expression: "* * * * *" },
      workflowTemplateID: "builtin:noop-dry-run",
    })
  }

  // Seed trailing real failures so the failure-policy backoff at the next
  // recorded outcome is longer than the schedule's own next fire — otherwise
  // max(next_run_at, now + backoff) hides a repeated application.
  function seedPriorFailures(taskID: ScheduledTaskID, count: number) {
    const now = Date.now()
    SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
      for (let index = 0; index < count; index++) {
        const at = now - 1_000 * (index + 1)
        db.insert(ScheduledTaskRunTable)
          .values({
            id: ScheduledTaskRunID.ascending(),
            task_id: taskID,
            project_id: Instance.project.id,
            trigger_type: "scheduled",
            status: "failed",
            error: "earlier failure",
            occurrence_at: at,
            time_started: at,
            time_completed: at + 1,
            time_created: at,
            time_updated: at + 1,
          })
          .run()
      }
    })
  }

  test("a workflow outcome without a run ID cannot settle a prompt occurrence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await ScheduledTask.create({
          title: "Prompt occurrence",
          prompt: "Run once.",
          schedule: { type: "once", runAt: Date.now() + 60_000 },
        })
        const { queueItem, task: claimed } = await ScheduledTask.runNow(task.id)
        if (!queueItem) throw new Error("Expected a scheduled prompt queue item")

        // Untyped callers must satisfy the same identity check.
        const report = ScheduledTask.recordWorkflowOutcome
        await expect(Reflect.apply(report, undefined, [task.id, "completed", undefined])).rejects.toMatchObject({
          name: "ZodError",
        })

        expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([
          { status: "running", queueID: queueItem.id },
        ])
        expect(await ScheduledTask.get(task.id)).toEqual(claimed)
      },
    })
  })

  test("a repeated outcome report does not push the failure retry later", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workflowRunID = WorkflowRunID.ascending()
        const { createRun, start } = await mockWorkflowDispatch(workflowRunID)
        try {
          const task = await createWorkflowTask()
          await ScheduledTask.runNow(task.id)

          const error = new Error("orphaned: workflow lease expired")
          await ScheduledTask.recordWorkflowOutcome(task.id, "failed", error, workflowRunID)
          const first = await ScheduledTask.get(task.id)
          expect(first.error).toBe(error.message)
          expect(first.nextRunAt).toBeDefined()

          await new Promise((resolve) => setTimeout(resolve, 20))
          await ScheduledTask.recordWorkflowOutcome(task.id, "failed", error, workflowRunID)
          const second = await ScheduledTask.get(task.id)
          expect(second.nextRunAt).toBe(first.nextRunAt)
        } finally {
          createRun.mockRestore()
          start.mockRestore()
        }
      },
    })
  })

  test.each(["completed", "failed"] as const)("adopts a late %s workflow outcome exactly once", async (status) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workflowRunID = WorkflowRunID.ascending()
        const { createRun, start } = await mockWorkflowDispatch(workflowRunID)
        try {
          const task = await createWorkflowTask()
          await ScheduledTask.runNow(task.id)
          seedPriorFailures(task.id, 3)

          // Simulate reconcileOrphanRuns finalizing the open run: it marks the
          // row failed without applying the failure policy, so the real
          // outcome still owes the task summary and retry policy.
          const now = Date.now()
          SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
            db.update(ScheduledTaskRunTable)
              .set({
                status: "failed",
                error: "orphaned: no outcome was recorded (backend likely restarted)",
                time_completed: now,
                time_updated: now,
              })
              .where(and(eq(ScheduledTaskRunTable.task_id, task.id), eq(ScheduledTaskRunTable.status, "running")))
              .run()
          })

          const error = new Error("workflow really failed")
          const adopted = await ScheduledTask.recordWorkflowOutcome(task.id, status, error, workflowRunID)
          const message = status === "failed" ? error.message : undefined
          expect(adopted.error).toBe(message)
          const run = (await ScheduledTask.listRuns({ taskID: task.id })).find(
            (candidate) => candidate.workflowRunID === workflowRunID,
          )
          expect(run?.status).toBe(status)
          expect(run?.error).toBe(message)
          expect(run?.timeCompleted).toBe(now)
          expect(adopted.nextRunAt).toBeDefined()

          await new Promise((resolve) => setTimeout(resolve, 20))
          await ScheduledTask.recordWorkflowOutcome(task.id, status, error, workflowRunID)
          const repeat = await ScheduledTask.get(task.id)
          expect(repeat.nextRunAt).toBe(adopted.nextRunAt)
        } finally {
          createRun.mockRestore()
          start.mockRestore()
        }
      },
    })
  })

  test("an old workflow outcome does not terminate a newer running occurrence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await createWorkflowTask()
        const now = Date.now()
        const oldRun = ScheduledTaskRunID.ascending()
        const newRun = ScheduledTaskRunID.ascending()
        SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
          for (const [id, workflowRunID, offset] of [
            [oldRun, "wfr_old", 0],
            [newRun, "wfr_new", 1],
          ] as const) {
            db.insert(ScheduledTaskRunTable)
              .values({
                id,
                task_id: task.id,
                project_id: Instance.project.id,
                trigger_type: "scheduled",
                status: "running",
                occurrence_at: now + offset,
                time_started: now + offset,
                time_created: now + offset,
                time_updated: now + offset,
                workflow_run_id: workflowRunID,
              })
              .run()
          }
        })

        await ScheduledTask.recordWorkflowOutcome(
          task.id,
          "failed",
          new Error("old workflow failed"),
          WorkflowRunID.zod.parse("wfr_old"),
        )
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.find((run) => run.workflowRunID === "wfr_old")?.status).toBe("failed")
        // The new occurrence's workflow is still executing; the old outcome
        // must not finalize its row or release overlap protection.
        expect(runs.find((run) => run.workflowRunID === "wfr_new")?.status).toBe("running")
      },
    })
  })

  test.each(["completed", "failed"] as const)(
    "a stale %s workflow outcome preserves the current task summary",
    async (status) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await createWorkflowTask()
          const now = Date.now()
          const oldRun = ScheduledTaskRunID.ascending()
          const newRun = ScheduledTaskRunID.ascending()
          SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
            for (const [id, workflowRunID, offset] of [
              [oldRun, "wfr_old", 0],
              [newRun, "wfr_new", 1],
            ] as const) {
              db.insert(ScheduledTaskRunTable)
                .values({
                  id,
                  task_id: task.id,
                  project_id: Instance.project.id,
                  trigger_type: "scheduled",
                  status: "running",
                  occurrence_at: now + offset,
                  time_started: now + offset,
                  time_created: now + offset,
                  time_updated: now + offset,
                  workflow_run_id: workflowRunID,
                })
                .run()
            }
          })

          seedPriorFailures(task.id, 4)
          SessionShard.storeForProject(Instance.project.id, { write: true }).use((db) => {
            db.update(ScheduledTaskTable)
              .set({ last_workflow_run_id: "wfr_new", error: "current occurrence state" })
              .where(eq(ScheduledTaskTable.id, task.id))
              .run()
          })
          const before = await ScheduledTask.get(task.id)
          await ScheduledTask.recordWorkflowOutcome(
            task.id,
            status,
            new Error("old workflow failed"),
            WorkflowRunID.zod.parse("wfr_old"),
          )
          const after = await ScheduledTask.get(task.id)
          expect(after.error).toBe(before.error)
          expect(after.status).toBe(before.status)
          expect(after.nextRunAt).toBe(before.nextRunAt)
          const runs = await ScheduledTask.listRuns({ taskID: task.id })
          expect(runs.find((run) => run.workflowRunID === "wfr_old")?.status).toBe(status)
          // The new occurrence's workflow is still executing; the old outcome
          // must not finalize its row or release overlap protection.
          expect(runs.find((run) => run.workflowRunID === "wfr_new")?.status).toBe("running")
        },
      })
    },
  )

  test.each(["completed", "failed"] as const)("a current %s workflow outcome updates its task", async (status) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await mockWorkflowDispatch("wfr_current")
        const task = await createWorkflowTask()
        await ScheduledTask.runNow(task.id)
        seedPriorFailures(task.id, 4)
        await ScheduledTask.recordWorkflowOutcome(
          task.id,
          status,
          new Error("current workflow failed"),
          WorkflowRunID.zod.parse("wfr_current"),
        )
        const current = await ScheduledTask.get(task.id)
        expect(current.status).toBe(status === "failed" ? "paused" : "active")
        expect(current.error).toBe(
          status === "failed" ? "auto-paused after 5 consecutive failures: current workflow failed" : undefined,
        )
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs.find((run) => run.workflowRunID === "wfr_current")?.status).toBe(status)
      },
    })
  })

  test("a run-now whose workflow start fails cancels the pre-created run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
        process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
        // A real createRun persists the queued run; only start fails, as it does
        // for the runtime-disabled guard or an unsupported merge strategy.
        const start = vi.spyOn(WorkflowScheduler, "start").mockRejectedValue(new Error("start failed"))
        try {
          const task = await createWorkflowTask()
          await expect(ScheduledTask.runNow(task.id)).rejects.toThrow()

          // The pre-created run never started. It must be cancelled rather than
          // left `queued` forever — recoverInterrupted only sweeps `running` rows
          // and there is no workflow-run retention.
          const runs = await WorkflowRun.list()
          expect(runs).toHaveLength(1)
          expect(runs[0]!.status).toBe("cancelled")

          const taskRuns = await ScheduledTask.listRuns({ taskID: task.id })
          expect(taskRuns.some((run) => run.status === "failed")).toBe(true)
        } finally {
          start.mockRestore()
          if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
          else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
        }
      },
    })
  })

  test("a run-now on a runtime-disabled workflow still cancels the pre-created run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
        delete process.env.AX_CODE_WORKFLOW_RUNTIME
        try {
          const task = await createWorkflowTask()
          await expect(ScheduledTask.runNow(task.id)).rejects.toThrow()

          // The start failed BECAUSE the spec is runtime-disabled, so cancel()
          // re-runs the same enablement gate and throws the same error. The
          // cleanup must not depend on it, or the pre-created run stays `queued`
          // with no sweep to repair it (recoverInterrupted only looks at
          // `running` rows).
          const runs = await WorkflowRun.list()
          expect(runs).toHaveLength(1)
          expect(runs[0]!.status).toBe("cancelled")
        } finally {
          if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
          else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
        }
      },
    })
  })

  test("cancelling a running workflow releases its scheduled dispatch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
        try {
          vi.spyOn(WorkflowScheduler, "start").mockImplementation(async (id) => {
            await WorkflowRun.setStatus({ id, status: "running" })
            return WorkflowRun.getDetail(id)
          })
          const task = await createWorkflowTask()
          const first = (await ScheduledTask.runNow(task.id)).workflowRun
          if (!first) throw new Error("Expected the first workflow dispatch")

          expect((await WorkflowScheduler.cancel(first.id)).status).toBe("cancelled")

          expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([
            { workflowRunID: first.id, status: "failed", error: "Scheduled workflow was cancelled." },
          ])
          const second = (await ScheduledTask.runNow(task.id)).workflowRun
          expect(second?.id).toBeDefined()
          expect(second?.id).not.toBe(first.id)
        } finally {
          vi.unstubAllEnvs()
        }
      },
    })
  })

  test("deleting a task cancels its running workflow run", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
        try {
          vi.spyOn(WorkflowScheduler, "start").mockImplementation(async (id) => {
            await WorkflowRun.setStatus({ id, status: "running" })
            return WorkflowRun.getDetail(id)
          })
          const task = await createWorkflowTask()
          const { workflowRun } = await ScheduledTask.runNow(task.id)
          if (!workflowRun) throw new Error("Expected a claimed workflow")
          expect(workflowRun.status).toBe("running")

          expect(await ScheduledTask.remove(task.id)).toBe(true)
          expect((await WorkflowRun.get(workflowRun.id)).status).toBe("cancelled")
          await expect(ScheduledTask.get(task.id)).rejects.toThrow()
        } finally {
          vi.unstubAllEnvs()
        }
      },
    })
  })

  test("an inline workflow completing late preserves the replacement reminder", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workflowRunID = WorkflowRunID.ascending()
        await mockWorkflowDispatch(workflowRunID)
        const task = await ScheduledTask.create({
          title: "Rescheduled workflow",
          prompt: "Run once.",
          schedule: { type: "once", runAt: Date.now() + 60_000 },
          workflowTemplateID: "builtin:noop-dry-run",
        })
        await ScheduledTask.runNow(task.id)
        const runAt = Date.now() + 120_000
        const replacement = await ScheduledTask.update({ id: task.id, schedule: { type: "once", runAt } })
        expect(replacement.lastWorkflowRunID).toBe(workflowRunID)

        await ScheduledTask.recordWorkflowOutcome(task.id, "completed", undefined, workflowRunID)
        expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([
          { status: "completed", workflowRunID },
        ])
        expect(await ScheduledTask.get(task.id)).toEqual(replacement)
      },
    })
  })

  test("a workflow can only link to the occurrence claimed by its queue item", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await createWorkflowTask()
        if (!task.nextRunAt) throw new Error("Expected a due time")
        const older = await TaskQueue.enqueue({
          kind: "automation",
          title: "Older dispatch",
          sourceTaskID: task.id,
          payload: { scheduledTaskID: task.id, workflowTemplateID: task.workflowTemplateID },
        })
        const [fired] = await ScheduledTask.runDue(task.nextRunAt + 6 * 60_000)
        if (!fired?.queueItem) throw new Error("Expected a queued scheduled workflow")
        const olderClaim = await TaskQueue.claimForExecution(older.id)
        if (olderClaim.kind !== "claimed") throw new Error("Expected the older carrier claim")

        await ScheduledTask.recordWorkflowRun(task.id, WorkflowRunID.ascending(), olderClaim.attempt)
        expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([
          { queueID: fired.queueItem.id, workflowRunID: undefined },
        ])
        expect((await ScheduledTask.get(task.id)).lastWorkflowRunID).toBeUndefined()

        const claim = await TaskQueue.claimForExecution(fired.queueItem.id)
        if (claim.kind !== "claimed") throw new Error("Expected the current carrier claim")
        const workflowRunID = WorkflowRunID.ascending()
        await ScheduledTask.recordWorkflowRun(task.id, workflowRunID, claim.attempt)
        expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([
          { queueID: claim.item.id, workflowRunID },
        ])
        expect((await ScheduledTask.get(task.id)).lastWorkflowRunID).toBe(workflowRunID)

        await TaskQueue.finishExecution(claim.attempt, { status: "failed" })
        await ScheduledTask.recordQueueOutcome(task.id, "failed", "Original dispatch failed", claim.item.id)
        await TaskQueue.retry(claim.item.id)
        const retry = await TaskQueue.claimForExecution(claim.item.id)
        if (retry.kind !== "claimed") throw new Error("Expected the retry claim")
        await expect(
          ScheduledTask.recordWorkflowRun(task.id, WorkflowRunID.ascending(), claim.attempt),
        ).rejects.toThrow("Scheduled automation stopped before execution")
        expect((await ScheduledTask.get(task.id)).lastWorkflowRunID).toBe(workflowRunID)

        const retriedWorkflowID = WorkflowRunID.ascending()
        await ScheduledTask.recordWorkflowRun(task.id, retriedWorkflowID, retry.attempt)
        expect((await ScheduledTask.get(task.id)).lastWorkflowRunID).toBe(retriedWorkflowID)
        expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([{ status: "failed", workflowRunID }])
      },
    })
  })

  async function linkOneShotWorkflow() {
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
    const runAt = Date.now() + 60_000
    const task = await ScheduledTask.create({
      title: "Scheduled workflow",
      prompt: "Run once.",
      schedule: { type: "once", runAt },
      workflowTemplateID: "builtin:noop-dry-run",
    })
    const now = runAt + 1_000
    const [fired] = await ScheduledTask.runDue(now)
    if (!fired?.queueItem) throw new Error("Expected a scheduled workflow carrier")
    const workflow = await WorkflowTemplate.createRun({ templateID: "builtin:noop-dry-run", sourceTaskID: task.id })
    const carrier = await TaskQueue.claimForExecution(fired.queueItem.id)
    if (carrier.kind !== "claimed") throw new Error("Expected the carrier claim")
    await ScheduledTask.recordWorkflowRun(task.id, workflow.id, carrier.attempt)
    return { task, workflow, carrier, now }
  }

  test.each([false, true])(
    "a started workflow owns its outcome after carrier failure (sharded=%s)",
    async (sharded) => {
      vi.stubEnv("AX_CODE_SHARD_SESSIONS", sharded ? "1" : "0")
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { task, workflow, carrier, now } = await linkOneShotWorkflow()
          await WorkflowRun.setStatus({ id: workflow.id, status: "running" })
          await TaskQueue.finishExecution(carrier.attempt, { status: "failed", error: "Carrier interrupted" })
          await ScheduledTask.recordQueueOutcome(task.id, "failed", "Carrier interrupted", carrier.item.id)

          await ScheduledTask.reconcileAllOrphanRuns(now + 1_000)
          expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([
            { status: "running", workflowRunID: workflow.id },
          ])
          expect(await ScheduledTask.get(task.id)).toMatchObject({
            status: "active",
            error: undefined,
            nextRunAt: undefined,
          })
          await expect(ScheduledTask.runNow(task.id)).rejects.toMatchObject({ status: 409 })

          expect((await WorkflowScheduler.start(workflow.id)).status).toBe("completed")
          await ScheduledTask.reconcileAllOrphanRuns(now + 2_000)
          expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([
            { status: "completed", workflowRunID: workflow.id },
          ])
          expect(await ScheduledTask.get(task.id)).toMatchObject({ status: "disabled", nextRunAt: undefined })
        },
      })
    },
  )

  test.each([false, true])("recovery settles a failed carrier before workflow start (sharded=%s)", async (sharded) => {
    vi.stubEnv("AX_CODE_SHARD_SESSIONS", sharded ? "1" : "0")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { task, workflow, carrier, now } = await linkOneShotWorkflow()
        const error = "Carrier interrupted before workflow start"
        await TaskQueue.finishExecution(carrier.attempt, { status: "failed", error })

        const sweepAt = now + 1_000
        await ScheduledTask.reconcileAllOrphanRuns(sweepAt)

        expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([
          { status: "failed", workflowRunID: workflow.id, error },
        ])
        const saved = await ScheduledTask.get(task.id)
        expect(saved).toMatchObject({ status: "active", error })
        expect(saved.nextRunAt).toBeGreaterThan(sweepAt)
        await ScheduledTask.reconcileAllOrphanRuns(sweepAt + 1_000)
        expect(await ScheduledTask.get(task.id)).toEqual(saved)
      },
    })
  })

  test.each([true, false])("a saved workflow outcome requires its link (linked=%s)", async (linked) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
        try {
          vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
          const task = await createWorkflowTask()
          if (!task.nextRunAt) throw new Error("Expected a due time")
          const now = task.nextRunAt + 6 * 60_000
          const [fired] = await ScheduledTask.runDue(now)
          if (!fired?.queueItem) throw new Error("Expected a queued scheduled workflow")
          const run = await WorkflowTemplate.createRun({ templateID: "builtin:noop-dry-run", sourceTaskID: task.id })
          await WorkflowRun.setStatus({ id: run.id, status: "running" })
          const carrier = await TaskQueue.claimForExecution(fired.queueItem.id)
          if (carrier.kind !== "claimed") throw new Error("Expected the carrier claim")
          if (linked) await ScheduledTask.recordWorkflowRun(task.id, run.id, carrier.attempt)
          await TaskQueue.finishExecution(carrier.attempt, { status: "completed" })

          await ScheduledTask.reconcileAllOrphanRuns(now)
          expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([{ status: "running" }])

          await WorkflowRun.setStatus({ id: run.id, status: "failed", error: "Persisted workflow failure" })
          await ScheduledTask.reconcileAllOrphanRuns(now)
          const outcome = linked
            ? { status: "failed", error: "Persisted workflow failure" }
            : { status: "running", error: undefined }
          expect(await ScheduledTask.listRuns({ taskID: task.id })).toMatchObject([outcome])
          expect(await ScheduledTask.get(task.id)).toMatchObject({ status: "active", error: outcome.error })
        } finally {
          vi.unstubAllEnvs()
        }
      },
    })
  })

  test("deleting a scheduled dispatch stops both its queue carrier and its linked workflow", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
        try {
          vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
          const task = await createWorkflowTask()
          if (!task.nextRunAt) throw new Error("Expected a due time")
          const [fired] = await ScheduledTask.runDue(task.nextRunAt + 6 * 60_000)
          if (!fired?.queueItem) throw new Error("Expected a queued scheduled workflow")
          const run = await WorkflowTemplate.createRun({ templateID: "builtin:noop-dry-run", sourceTaskID: task.id })
          await WorkflowRun.setStatus({ id: run.id, status: "running" })
          const carrier = await TaskQueue.claimForExecution(fired.queueItem.id)
          if (carrier.kind !== "claimed") throw new Error("Expected the carrier claim")
          await ScheduledTask.recordWorkflowRun(task.id, run.id, carrier.attempt)

          expect(await ScheduledTask.remove(task.id)).toBe(true)

          expect((await TaskQueue.get(fired.queueItem.id)).status).toBe("cancelled")
          expect((await WorkflowRun.get(run.id)).status).toBe("cancelled")
        } finally {
          vi.unstubAllEnvs()
        }
      },
    })
  })
})
