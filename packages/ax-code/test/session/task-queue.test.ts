import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { TaskQueue } from "../../src/session/task-queue"
import { TaskQueueExecutor } from "../../src/session/task-queue-executor"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("TaskQueue", () => {
  test("persists lifecycle state and publishes durable queue events", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const events: string[] = []
        const unsubscribeCreated = Bus.subscribe(TaskQueue.Event.Created, (event) => {
          events.push(event.type)
        })
        const unsubscribeUpdated = Bus.subscribe(TaskQueue.Event.Updated, (event) => {
          events.push(`${event.type}:${event.properties.item.status}`)
        })
        const unsubscribeDeleted = Bus.subscribe(TaskQueue.Event.Deleted, (event) => {
          events.push(event.type)
        })

        try {
          const created = await TaskQueue.enqueue({
            sessionID: session.id,
            kind: "prompt",
            title: "Run desktop follow-up",
            worktree: "wt-desktop",
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            sourceMessageID: "msg_task_queue_source",
            sourceTaskID: "tsk_task_queue_parent",
            priority: 5,
            payload: { prompt: "continue" },
          })

          expect(created.id).toStartWith("tsk_")
          expect(created.projectID).toBe(session.projectID)
          expect(created.sessionID).toBe(session.id)
          expect(created.status).toBe("queued")
          expect(created.worktree).toBe("wt-desktop")
          expect(created.agent).toBe("build")
          expect(created.model).toEqual({ providerID: "test", modelID: "test-model" })
          expect(created.sourceMessageID).toBe("msg_task_queue_source")
          expect(created.sourceTaskID).toBe("tsk_task_queue_parent")

          const list = await TaskQueue.list({ sessionID: session.id })
          expect(list.map((item) => item.id)).toEqual([created.id])
          expect(list[0]?.worktree).toBe("wt-desktop")

          const paused = await TaskQueue.pause(created.id)
          expect(paused.status).toBe("paused")

          const resumed = await TaskQueue.resume(created.id)
          expect(resumed.status).toBe("queued")

          const running = await TaskQueue.setStatus({ id: created.id, status: "running" })
          expect(running.time.started).toBeDefined()
          await expect(TaskQueue.pause(created.id)).rejects.toThrow("Cannot pause")
          await expect(TaskQueue.sendNow(created.id)).rejects.toThrow("Cannot send now")

          const failed = await TaskQueue.setStatus({ id: created.id, status: "failed", error: "model failed" })
          expect(failed.error).toBe("model failed")
          expect(failed.time.completed).toBeDefined()
          await expect(TaskQueue.cancel(created.id)).rejects.toThrow("Cannot cancel")

          const retried = await TaskQueue.retry(created.id)
          expect(retried.status).toBe("queued")
          expect(retried.error).toBeUndefined()
          expect(retried.time.started).toBeUndefined()
          expect(retried.time.completed).toBeUndefined()
          await expect(TaskQueue.retry(created.id)).rejects.toThrow("Cannot retry")

          const reordered = await TaskQueue.reorder({ id: created.id, position: 10 })
          expect(reordered.position).toBe(0)

          const sentNow = await TaskQueue.sendNow(created.id)
          expect(sentNow.status).toBe("queued")
          expect(sentNow.position).toBe(0)

          const edited = await TaskQueue.edit({
            id: created.id,
            title: "Run edited desktop follow-up",
            worktree: null,
            agent: "review",
            payload: { prompt: "continue with the edited queue item" },
            priority: 3,
          })
          expect(edited.title).toBe("Run edited desktop follow-up")
          expect(edited.worktree).toBeUndefined()
          expect(edited.agent).toBe("review")
          expect(edited.payload).toEqual({ prompt: "continue with the edited queue item" })
          expect(edited.priority).toBe(3)

          await TaskQueue.setStatus({ id: created.id, status: "running" })
          await expect(TaskQueue.edit({ id: created.id, title: "Cannot edit running item" })).rejects.toThrow()

          expect(await TaskQueue.remove(created.id)).toBe(true)
          expect(await TaskQueue.list({ sessionID: session.id })).toEqual([])
          await new Promise((resolve) => setTimeout(resolve, 0))

          expect(events).toContain("task.queue.created")
          expect(events).toContain("task.queue.updated:running")
          expect(events).toContain("task.queue.updated:failed")
          expect(events).toContain("task.queue.deleted")
        } finally {
          unsubscribeCreated()
          unsubscribeUpdated()
          unsubscribeDeleted()
          await Session.remove(session.id)
        }
      },
    })
  })

  test("recovers interrupted active items after backend restart", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const running = await TaskQueue.enqueue({ kind: "prompt", title: "Interrupted prompt" })
        const blocked = await TaskQueue.enqueue({ kind: "review", title: "Interrupted review" })
        const waiting = await TaskQueue.enqueue({ kind: "automation", title: "Waiting for idle" })
        const queued = await TaskQueue.enqueue({ kind: "followup", title: "Still queued" })

        await TaskQueue.setStatus({ id: running.id, status: "running" })
        await TaskQueue.setStatus({ id: blocked.id, status: "blocked_permission", error: "approval required" })
        await TaskQueue.setStatus({ id: waiting.id, status: "waiting_for_idle" })

        const recovered = await TaskQueue.recoverInterrupted()

        expect(recovered.failed.map((item) => item.id).sort()).toEqual([blocked.id, running.id].sort())
        expect(recovered.requeued.map((item) => item.id)).toEqual([waiting.id])

        const failedRunning = await TaskQueue.get(running.id)
        expect(failedRunning.status).toBe("failed")
        expect(failedRunning.error).toContain("backend restart")
        expect(failedRunning.time.completed).toBeDefined()

        const failedBlocked = await TaskQueue.get(blocked.id)
        expect(failedBlocked.status).toBe("failed")
        expect(failedBlocked.error).toContain("backend restart")

        const requeuedWaiting = await TaskQueue.get(waiting.id)
        expect(requeuedWaiting.status).toBe("queued")
        expect(requeuedWaiting.error).toBeUndefined()
        expect(requeuedWaiting.time.started).toBeUndefined()
        expect(requeuedWaiting.time.completed).toBeUndefined()

        expect((await TaskQueue.get(queued.id)).status).toBe("queued")
      },
    })
  })

  test("orders project queue items by server position", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await TaskQueue.enqueue({ kind: "review", title: "Review first branch" })
        const second = await TaskQueue.enqueue({ kind: "automation", title: "Run smoke checks" })

        expect((await TaskQueue.list()).map((item) => item.id)).toEqual([first.id, second.id])

        const reorderedSecond = await TaskQueue.reorder({ id: second.id, position: 0 })
        const reorderedFirst = await TaskQueue.reorder({ id: first.id, position: 1 })

        expect(reorderedSecond.position).toBe(0)
        expect(reorderedFirst.position).toBe(1)

        expect((await TaskQueue.list()).map((item) => item.id)).toEqual([second.id, first.id])

        await TaskQueue.sendNow(first.id)
        expect((await TaskQueue.list()).map((item) => item.id)).toEqual([first.id, second.id])

        await TaskQueue.remove(first.id)
        await TaskQueue.remove(second.id)
      },
    })
  })

  test("reflects permission and question blockers on active queue items", async () => {
    await using tmp = await tmpdir({ git: true })
    const previousAutonomous = process.env.AX_CODE_AUTONOMOUS
    process.env.AX_CODE_AUTONOMOUS = "false"

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          TaskQueueExecutor.initSessionBlockObservers()
          const session = await Session.create({})
          const item = await TaskQueue.enqueue({
            sessionID: session.id,
            kind: "prompt",
            title: "Run blocked follow-up",
            payload: { text: "continue" },
          })

          await TaskQueue.setStatus({ id: item.id, status: "running" })
          const permissionAsk = Permission.ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["pnpm test"],
            metadata: {},
            always: ["pnpm test"],
            ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
          })
          const permission = await waitForValue("permission request", async () => (await Permission.list())[0])
          await waitForQueueStatus(item.id, "blocked_permission")

          await Permission.reply({ requestID: permission.id, reply: "once" })
          await permissionAsk
          await waitForQueueStatus(item.id, "running")

          const questionAsk = Question.ask({
            sessionID: session.id,
            questions: [
              {
                header: "Target",
                question: "Which target should be used?",
                options: [{ label: "main", description: "Use the main target." }],
              },
            ],
          })
          const question = await waitForValue("question request", async () => (await Question.list())[0])
          await waitForQueueStatus(item.id, "blocked_question")

          await Question.reply({ requestID: question.id, answers: [["main"]] })
          await questionAsk
          await waitForQueueStatus(item.id, "running")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (previousAutonomous === undefined) delete process.env.AX_CODE_AUTONOMOUS
      else process.env.AX_CODE_AUTONOMOUS = previousAutonomous
    }
  })

  test("applies workflow child tool and isolation policy as turn-scoped prompt metadata", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const item = await TaskQueue.enqueue({
          sessionID: session.id,
          kind: "subagent",
          title: "Run workflow child",
          payload: {
            workflow: {
              runID: "wfr_test",
              phaseID: "wfp_test",
              childID: "wfc_test",
              specPhaseID: "scan",
            },
            allowedTools: ["file.read", "rg", "verify_project", "github.issue.view"],
            writePolicy: "read-only",
            networkPolicy: "disabled",
            body: {
              noReply: true,
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              tools: { grep: false, write: true },
              isolation: { mode: "full-access", network: true },
              parts: [{ type: "text", text: "Inspect the repository without mutating it." }],
            },
          },
        })

        await TaskQueueExecutor.start(item)
        await waitForQueueStatus(item.id, "completed")

        const messages = await Session.messages({ sessionID: session.id })
        const user = messages.find((message) => message.info.role === "user")
        expect(user?.info).toMatchObject({
          tools: {
            "*": false,
            "file.read": true,
            file_read: true,
            read: true,
            rg: true,
            grep: false,
            verify_project: true,
            "github.issue.view": true,
            github_issue_view: true,
          },
          isolation: {
            mode: "read-only",
            network: false,
          },
        })

        expect((await Session.get(session.id)).permission ?? []).toEqual([])
      },
    })
  })
})

async function waitForQueueStatus(id: TaskQueue.Info["id"], status: TaskQueue.Status) {
  await waitForValue(`queue status ${status}`, async () => {
    const item = await TaskQueue.get(id)
    return item.status === status ? item : undefined
  })
}

async function waitForValue<T>(label: string, read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
