import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { ScheduledTask } from "../../src/session/scheduled-task"
import { TaskQueueID } from "../../src/session/schema"
import { TaskQueueTable } from "../../src/session/session.sql"
import { SessionShard } from "../../src/session/shard"
import { eq } from "../../src/storage/db"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { getParsedWorkflowFixtureSpec, WorkflowRun, WorkflowScheduler, WorkflowTemplate } from "../../src/workflow"
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

  test.each(["run-now", "due"] as const)("binds a %s queue item to the saved task checkout", async (trigger) => {
    await using tmp = await tmpdir({ git: true })
    await using linked = await tmpdir()
    execFileSync("git", ["worktree", "add", "--detach", linked.path], { cwd: tmp.path, stdio: "pipe" })
    vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
    const now = Date.now()
    const task = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        ScheduledTask.create({
          title: "Workspace-specific automation",
          prompt: "Use the saved workspace.",
          schedule: { type: "once", runAt: now + 60_000 },
        }),
    })

    await Instance.provide({
      directory: linked.path,
      fn: async () => {
        expect(Instance.project.id).toBe(task.projectID)
        const dispatched =
          trigger === "run-now"
            ? await ScheduledTask.runNow(task.id)
            : (await ScheduledTask.runDue(now + 7 * 60_000))[0]
        expect(dispatched?.queueItem?.directory).toBe(tmp.path)
      },
    })
  })

  test.each(["run-now", "due"] as const)("loads the %s workflow template from the saved checkout", async (trigger) => {
    await using tmp = await tmpdir({ git: true })
    await using linked = await tmpdir()
    execFileSync("git", ["worktree", "add", "--detach", linked.path], { cwd: tmp.path, stdio: "pipe" })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      const spec = getParsedWorkflowFixtureSpec("noopDryRun")
      const now = Date.now()
      const task = await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const template = await WorkflowTemplate.save({ scope: "project", trust: "trusted", spec })
          return ScheduledTask.create({
            title: "Workspace-specific workflow",
            prompt: "Run the saved workflow.",
            schedule: { type: "once", runAt: now + 60_000 },
            workflowTemplateID: template.id,
          })
        },
      })
      await Instance.provide({
        directory: linked.path,
        fn: async () => {
          expect(Instance.project.id).toBe(task.projectID)
          await WorkflowTemplate.save({ scope: "project", trust: "trusted", spec: { ...spec, name: "Other checkout" } })
          if (trigger === "run-now") await ScheduledTask.runNow(task.id)
          else expect(await ScheduledTask.runDue(now + 7 * 60_000)).toHaveLength(1)
          await vi.waitFor(async () => {
            expect(await WorkflowRun.list()).toContainEqual(
              expect.objectContaining({
                directory: tmp.path,
                status: "completed",
                spec: expect.objectContaining({ name: spec.name }),
              }),
            )
          })
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test.each(["pending", "attached"] as const)("recovers a legacy %s dispatch with a stale directory", async (state) => {
    await using tmp = await tmpdir({ git: true })
    await using linked = await tmpdir()
    execFileSync("git", ["worktree", "add", "--detach", linked.path], { cwd: tmp.path, stdio: "pipe" })
    const prompt = vi.spyOn(SessionPrompt, "prompt").mockResolvedValue(undefined as never)
    const now = Date.now()
    const task = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        ScheduledTask.create({
          title: "Legacy scheduled dispatch",
          prompt: "Use the task's workspace.",
          schedule: { type: "once", runAt: now + 60_000 },
        }),
    })
    await Instance.provide({
      directory: linked.path,
      fn: async () => {
        const dispatch = vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const [fired] = await ScheduledTask.runDue(now + 7 * 60_000)
        dispatch.mockRestore()
        const id = fired?.queueItem?.id
        if (!id) throw new Error("Expected a queued scheduled run")
        const previous = state === "attached" ? await Session.create({ title: "Earlier attempt" }) : undefined
        SessionShard.storeForProject(task.projectID, { write: true }).use((db) =>
          db
            .update(TaskQueueTable)
            .set({ directory: linked.path, session_id: previous?.id })
            .where(eq(TaskQueueTable.id, id))
            .run(),
        )

        await TaskQueueExecutor.start(await TaskQueue.get(id))
        await vi.waitFor(
          async () => {
            const item = await TaskQueue.get(id)
            const expectedStatus = previous ? "failed" : "completed"
            expect(item.status).toBe(expectedStatus)
            expect((await ScheduledTask.listRuns({ taskID: task.id }))[0]?.status).toBe(expectedStatus)
            expect(item.directory).toBe(tmp.path)
            if (previous) {
              expect(item.error).toContain("different workspace")
              expect(item.sessionID).toBe(previous.id)
              expect(prompt).not.toHaveBeenCalled()
            } else {
              expect(prompt).toHaveBeenCalledOnce()
              expect((await Session.get(item.sessionID!)).directory).toBe(tmp.path)
            }
          },
          { timeout: 5_000 },
        )
      },
    })
  })

  test.each([
    { trigger: "run-now", replace: false },
    { trigger: "due", replace: false },
    { trigger: "due", replace: true },
  ])(
    "settles a $trigger dispatch when the saved checkout is unavailable (replaced=$replace)",
    async ({ trigger, replace }) => {
      await using tmp = await tmpdir({ git: true })
      await using linked = await tmpdir()
      execFileSync("git", ["worktree", "add", "--detach", linked.path], { cwd: tmp.path, stdio: "pipe" })
      const prompt = vi.spyOn(SessionPrompt, "prompt").mockResolvedValue(undefined as never)
      const now = Date.now()
      const task = await Instance.provide({
        directory: linked.path,
        fn: () =>
          ScheduledTask.create({
            title: "Unavailable checkout",
            prompt: "Use the saved workspace.",
            schedule: { type: "once", runAt: now + 60_000 },
          }),
      })
      await Instance.disposeAll()
      execFileSync("git", ["worktree", "remove", linked.path], { cwd: tmp.path, stdio: "pipe" })
      if (replace) await fs.mkdir(linked.path)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(Instance.project.id).toBe(task.projectID)
          const dispatched =
            trigger === "run-now"
              ? await ScheduledTask.runNow(task.id)
              : (await ScheduledTask.runDue(now + 7 * 60_000))[0]
          const queueID = dispatched?.queueItem?.id
          if (!queueID) throw new Error("Expected a scheduled queue item")
          await vi.waitFor(async () => {
            const item = await TaskQueue.get(queueID)
            expect(item).toMatchObject({
              status: "failed",
              directory: linked.path,
              error: expect.stringContaining("workspace"),
            })
            expect((await ScheduledTask.listRuns({ taskID: task.id }))[0]).toMatchObject({
              status: "failed",
              queueID,
            })
            expect(prompt).not.toHaveBeenCalled()
          })
        },
      })
    },
  )

  test("rejects workflow run-now when the saved workspace is gone", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = path.join(tmp.path, "workspace")
    await fs.mkdir(directory)
    const task = await Instance.provide({
      directory,
      fn: () =>
        ScheduledTask.create({
          title: "Missing workspace",
          prompt: "Use the original directory.",
          schedule: { type: "cron", expression: "* * * * *" },
          workflowTemplateID: "builtin:noop-dry-run",
        }),
    })
    await fs.rmdir(directory)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(ScheduledTask.runNow(task.id)).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining("workspace is unavailable"),
        })
        expect(await WorkflowRun.list()).toEqual([])
      },
    })
  })

  test.each(["manual", "scheduled"] as const)("%s dispatch failure settles the queue and run", async (trigger) => {
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
        if (trigger === "manual") {
          await expect(ScheduledTask.runNow(task.id)).rejects.toThrow("boom dispatch")
        } else {
          expect(await ScheduledTask.runDue(now + 7 * 60_000)).toEqual([])
        }
        const runs = await ScheduledTask.listRuns({ taskID: task.id })
        expect(runs).toHaveLength(1)
        const [run] = runs
        expect(run).toMatchObject({ status: "failed", error: "boom dispatch", queueID: expect.any(String) })
        expect(await TaskQueue.get(TaskQueueID.make(run.queueID!))).toMatchObject({
          status: "failed",
          error: "boom dispatch",
        })

        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const second = await ScheduledTask.runNow(task.id)
        expect(second.queueItem?.id).toBeDefined()
        expect(second.queueItem?.id).not.toBe(run.queueID)
      },
    })
  })

  test("dispatch failure preserves a queue item already claimed for execution", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementationOnce(async (item) => {
          expect((await TaskQueue.claimForExecution(item.id)).kind).toBe("claimed")
          throw new Error("boom dispatch")
        })
        const task = await ScheduledTask.create({
          title: "Concurrent dispatch",
          prompt: "Run once.",
          schedule: { type: "once", runAt: Date.now() + 60_000 },
        })
        await expect(ScheduledTask.runNow(task.id)).rejects.toThrow("boom dispatch")
        const [run] = await ScheduledTask.listRuns({ taskID: task.id })
        expect(run).toMatchObject({ status: "running", queueID: expect.any(String) })
        expect(await TaskQueue.get(TaskQueueID.make(run.queueID!))).toMatchObject({ status: "running" })
        await expect(ScheduledTask.runNow(task.id)).rejects.toMatchObject({ status: 409 })
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

  test.each(["open", "settled"] as const)(
    "delete retains the schedule when a retry replaces its attempt and history is %s",
    async (history) => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
          const task = await ScheduledTask.create({
            title: "Retried automation",
            prompt: "Run the scheduled fixture.",
            schedule: { type: "cron", expression: "* * * * *" },
          })
          const { queueItem } = await ScheduledTask.runNow(task.id)
          if (!queueItem) throw new Error("Expected a queued automation")
          const claim = await TaskQueue.claimForExecution(queueItem.id)
          if (claim.kind !== "claimed") throw new Error("Expected the automation to start")
          const session = await Session.create({})
          await TaskQueue.attachSession(claim.attempt, session.id)
          vi.spyOn(SessionPrompt, "cancel").mockImplementationOnce(async () => {
            await TaskQueue.finishExecution(claim.attempt, { status: "failed" })
            if (history === "settled") {
              await ScheduledTask.recordQueueOutcome(task.id, "failed", "Original attempt settled.", queueItem.id)
            }
            await TaskQueue.retry(queueItem.id)
            expect((await TaskQueue.claimForExecution(queueItem.id)).kind).toBe("claimed")
          })

          await expect(ScheduledTask.remove(task.id)).rejects.toMatchObject({ status: 409 })

          expect(await ScheduledTask.get(task.id)).toMatchObject({ id: task.id })
          expect(await TaskQueue.get(queueItem.id)).toMatchObject({ status: "running" })
        },
      })
    },
  )

  test("delete retains the schedule when a new run is admitted while the previous run stops", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.spyOn(TaskQueueExecutor, "start").mockImplementation(async (item) => item)
        const task = await ScheduledTask.create({
          title: "Concurrently dispatched automation",
          prompt: "Run the scheduled fixture.",
          schedule: { type: "cron", expression: "* * * * *" },
        })
        const first = await ScheduledTask.runNow(task.id)
        if (!first.queueItem) throw new Error("Expected a queued automation")
        const stop = TaskQueue.stop
        vi.spyOn(TaskQueue, "stop").mockImplementationOnce(async (queueID) => {
          const stopped = await stop(queueID)
          await ScheduledTask.recordQueueOutcome(task.id, "failed", "Stopped for test.", queueID)
          const next = await ScheduledTask.runNow(task.id)
          expect(next.queueItem?.id).not.toBe(queueID)
          return stopped
        })

        await expect(ScheduledTask.remove(task.id)).rejects.toMatchObject({ status: 409 })

        const open = (await ScheduledTask.listRuns({ taskID: task.id })).filter((run) => run.status === "running")
        expect(open).toHaveLength(1)
        expect(open[0]?.queueID).not.toBe(first.queueItem.id)
      },
    })
  })

  test("delete retains the schedule if a claimed workflow cannot be cancelled before dispatch", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
        try {
          vi.spyOn(WorkflowScheduler, "start").mockImplementation((id) => WorkflowRun.getDetail(id))
          const task = await ScheduledTask.create({
            title: "Pending workflow",
            prompt: "Run the scheduled workflow fixture.",
            schedule: { type: "cron", expression: "* * * * *" },
            workflowTemplateID: "builtin:noop-dry-run",
          })
          const { workflowRun } = await ScheduledTask.runNow(task.id)
          if (!workflowRun) throw new Error("Expected a claimed workflow")
          expect(workflowRun.status).toBe("queued")
          vi.spyOn(WorkflowScheduler, "cancel").mockRejectedValueOnce(new Error("Stop failed"))

          await expect(ScheduledTask.remove(task.id)).rejects.toMatchObject({ status: 409 })

          expect(await ScheduledTask.get(task.id)).toMatchObject({ id: task.id })
          expect((await WorkflowRun.get(workflowRun.id)).status).toBe("queued")
        } finally {
          vi.unstubAllEnvs()
        }
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

  test.each([
    { change: "disabled", update: { status: "disabled" as const }, message: /disabled/ },
    { change: "retargeted", update: { workflowTemplateID: "builtin:issue-triage" }, message: /changed/ },
  ])("rejects workflow run-now when its task was $change before the claim", async ({ update, message }) => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await ScheduledTask.create({
            title: "Workflow changed before claim",
            prompt: "Run the scheduled workflow.",
            schedule: { type: "cron", expression: "* * * * *" },
            workflowTemplateID: "builtin:noop-dry-run",
          })
          const createRun = WorkflowTemplate.createRun
          vi.spyOn(WorkflowTemplate, "createRun").mockImplementationOnce(async (input) => {
            const run = await createRun(input)
            await ScheduledTask.update({ id: task.id, ...update })
            return run
          })
          const start = vi.spyOn(WorkflowScheduler, "start")

          await expect(ScheduledTask.runNow(task.id)).rejects.toMatchObject({ status: 409, message })
          expect(start).not.toHaveBeenCalled()
          expect(await ScheduledTask.get(task.id)).toMatchObject(update)
          expect((await ScheduledTask.get(task.id)).error).toBeUndefined()
          expect(await ScheduledTask.listRuns({ taskID: task.id })).toEqual([])
          expect(await WorkflowRun.list()).toMatchObject([{ status: "cancelled", sourceTaskID: task.id }])
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test("starts a prepared workflow with the options saved at claim time", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.stubEnv("AX_CODE_WORKFLOW_RUNTIME", "1")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await ScheduledTask.create({
            title: "Updated workflow options",
            prompt: "Run the scheduled workflow.",
            schedule: { type: "cron", expression: "* * * * *" },
            workflowTemplateID: "builtin:noop-dry-run",
            workflowStartOptions: { allowWriteWorkflows: true },
          })
          const createRun = WorkflowTemplate.createRun
          vi.spyOn(WorkflowTemplate, "createRun").mockImplementationOnce(async (input) => {
            const run = await createRun(input)
            await ScheduledTask.update({ id: task.id, workflowStartOptions: { allowWriteWorkflows: false } })
            return run
          })
          const start = vi.spyOn(WorkflowScheduler, "start")
          const { workflowRun } = await ScheduledTask.runNow(task.id)
          expect(workflowRun?.status).toBe("completed")
          expect(start).toHaveBeenCalledWith(workflowRun?.id, { allowWriteWorkflows: false })
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test("a workflow run-now that loses the claim race cancels its pre-created run instead of leaking it", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
        process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
        try {
          // The winning claim must not start a real workflow; the losing
          // claim's pre-created run is the assertion target.
          vi.spyOn(WorkflowScheduler, "start").mockResolvedValue({ status: "running" } as never)
          // Barrier on createRun: runNow's open-run pre-check runs before the
          // workflow run is created, so without the barrier one caller can
          // finish its claim before the other even pre-checks, skipping the
          // racing window this test exercises.
          const realCreateRun = WorkflowTemplate.createRun.bind(WorkflowTemplate)
          const arrivals: (() => void)[] = []
          vi.spyOn(WorkflowTemplate, "createRun").mockImplementation(async (input) => {
            if (arrivals.length === 0) await new Promise<void>((resolve) => arrivals.push(resolve))
            else arrivals.forEach((resolve) => resolve())
            return realCreateRun(input)
          })
          const task = await ScheduledTask.create({
            title: "Workflow race probe",
            prompt: "Run the workflow once.",
            schedule: { type: "cron", expression: "* * * * *" },
            workflowTemplateID: "builtin:noop-dry-run",
          })

          const settled = await Promise.allSettled([ScheduledTask.runNow(task.id), ScheduledTask.runNow(task.id)])
          expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1)
          const rejected = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined
          expect(rejected?.reason).toMatchObject({ status: 409 })

          // Both attempts pre-created a run (create-first-claim-second keeps the
          // open-run guard authoritative). The losing claim must cancel its own
          // instead of leaving a never-started queued run behind.
          const runs = await WorkflowRun.list()
          expect(runs).toHaveLength(2)
          expect(runs.filter((run) => run.status === "cancelled")).toHaveLength(1)
        } finally {
          if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
          else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
        }
      },
    })
  })
})
