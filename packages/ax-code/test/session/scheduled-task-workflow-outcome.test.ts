import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { ScheduledTaskRunID, type ScheduledTaskID } from "../../src/session/schema"
import { ScheduledTaskRunTable } from "../../src/session/session.sql"
import { SessionShard } from "../../src/session/shard"
import { and, eq } from "../../src/storage/db"
import { WorkflowRun, WorkflowScheduler, WorkflowTemplate } from "../../src/workflow"
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

  test("a repeated outcome report does not push the failure retry later", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { createRun, start } = await mockWorkflowDispatch("wfr_outcome_drift")
        try {
          const task = await createWorkflowTask()
          await ScheduledTask.runNow(task.id)

          await ScheduledTask.recordWorkflowOutcome(task.id, "failed", new Error("workflow failed"))
          const first = await ScheduledTask.get(task.id)
          expect(first.error).toBe("workflow failed")
          expect(first.nextRunAt).toBeDefined()

          await new Promise((resolve) => setTimeout(resolve, 20))
          await ScheduledTask.recordWorkflowOutcome(task.id, "failed", new Error("workflow failed"))
          const second = await ScheduledTask.get(task.id)
          expect(second.nextRunAt).toBe(first.nextRunAt)
        } finally {
          createRun.mockRestore()
          start.mockRestore()
        }
      },
    })
  })

  test("a late outcome for an orphan-swept run applies the failure policy exactly once", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { createRun, start } = await mockWorkflowDispatch("wfr_outcome_orphan")
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

          await ScheduledTask.recordWorkflowOutcome(task.id, "failed", new Error("workflow really failed"))
          const adopted = await ScheduledTask.get(task.id)
          expect(adopted.error).toBe("workflow really failed")
          expect(adopted.nextRunAt).toBeDefined()

          await new Promise((resolve) => setTimeout(resolve, 20))
          await ScheduledTask.recordWorkflowOutcome(task.id, "failed", new Error("workflow really failed"))
          const repeat = await ScheduledTask.get(task.id)
          expect(repeat.nextRunAt).toBe(adopted.nextRunAt)
        } finally {
          createRun.mockRestore()
          start.mockRestore()
        }
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
})
