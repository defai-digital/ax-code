import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID, PartID, TaskQueueID, type SessionID } from "../../src/session/schema"
import { TaskQueue } from "../../src/session/task-queue"
import { ListBackgroundTasksTool } from "../../src/tool/list_background_tasks"
import { MessageBackgroundTaskInternals, MessageBackgroundTaskTool } from "../../src/tool/message_background_task"
import { tmpdir } from "../fixture/fixture"

const originalNudge = MessageBackgroundTaskInternals.nudge
let nudge: ReturnType<typeof vi.fn<(sessionID: SessionID) => Promise<unknown>>>

afterEach(async () => {
  MessageBackgroundTaskInternals.nudge = originalNudge
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

function stubNudge() {
  nudge = vi.fn((_sessionID: SessionID) => Promise.resolve())
  MessageBackgroundTaskInternals.nudge = nudge
}

function toolContext(sessionID: SessionID) {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
    extra: {},
  } as any
}

async function writeInitialPrompt(sessionID: SessionID, text: string) {
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "general",
    model: { providerID: "test" as any, modelID: "test-model" as any },
  } as any)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: user.id,
    sessionID,
    type: "text",
    text,
  } as any)
}

async function enqueueBackgroundSubagent(input: {
  parent: SessionID
  status?: TaskQueue.Status
  title?: string
  initialPrompt?: string
}) {
  const child = await Session.create({ parentID: input.parent, title: input.title ?? "background task" })
  if (input.initialPrompt !== undefined) {
    await writeInitialPrompt(child.id, input.initialPrompt)
  }
  const item = await TaskQueue.enqueue({
    sessionID: child.id,
    kind: "subagent",
    title: input.title ?? "background task",
    agent: "general",
    model: { providerID: "test", modelID: "test-model" },
    payload: {
      source: "task",
      resumeOnRestart: true,
      deliveryStatus: "pending",
      parentSessionID: input.parent,
    },
  })
  const status = input.status ?? "running"
  if (status !== "queued") {
    return { child, item: await TaskQueue.setStatus({ id: item.id, status }) }
  }
  return { child, item }
}

function controlTexts(messages: Awaited<ReturnType<typeof Session.messages>>, text: string) {
  return messages.filter(
    (message) =>
      message.info.role === "user" && message.parts.some((part) => part.type === "text" && part.text.includes(text)),
  )
}

describe("tool.list_background_tasks", () => {
  test("lists spawned background tasks and reflects their terminal status after completion", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const running = await enqueueBackgroundSubagent({
          parent: parent.id,
          status: "running",
          title: "scan the codebase",
        })
        const done = await enqueueBackgroundSubagent({
          parent: parent.id,
          status: "completed",
          title: "summarize docs",
        })

        const tool = await ListBackgroundTasksTool.init()
        expect(tool.concurrencySafe?.({})).toBe(true)

        const first = await tool.execute({}, toolContext(parent.id))
        expect(first.metadata.tasks).toHaveLength(2)
        expect(first.output).toContain(`queue_id: ${running.item.id}`)
        expect(first.output).toContain(`queue_id: ${done.item.id}`)
        expect(first.output).toContain(`task_id: ${running.child.id}`)
        expect(first.output).toContain("status: running")
        expect(first.output).toContain("status: completed")
        expect(first.output).toContain("scan the codebase")
        expect(first.output).toContain("summarize docs")
        expect(first.output).toContain("agent: general")

        // After completion the listing reflects the terminal status.
        await TaskQueue.setStatus({ id: running.item.id, status: "completed" })
        const second = await tool.execute({}, toolContext(parent.id))
        const row = second.metadata.tasks.find((task: any) => task.queueID === running.item.id)
        expect(row?.status).toBe("completed")
        expect(second.output).not.toContain("status: running")
      },
    })
  })

  test("does not list other sessions' tasks or non-background queue items", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const other = await Session.create({})
        await enqueueBackgroundSubagent({ parent: other.id, status: "running", title: "foreign task" })
        await TaskQueue.enqueue({ sessionID: parent.id, kind: "prompt", title: "plain queue item" })

        const result = await (await ListBackgroundTasksTool.init()).execute({}, toolContext(parent.id))
        expect(result.metadata.tasks).toHaveLength(0)
        expect(result.output).toContain("No background tasks")
      },
    })
  })
})

describe("tool.message_background_task", () => {
  test("delivers a message to a running child exactly once and nudges its prompt loop", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        stubNudge()
        const parent = await Session.create({})
        const { child, item } = await enqueueBackgroundSubagent({
          parent: parent.id,
          status: "running",
          initialPrompt: "do the original task",
        })

        const result = await (
          await MessageBackgroundTaskTool.init()
        ).execute({ task_id: item.id, message: "narrow the scope to src/" }, toolContext(parent.id))

        expect(result.metadata.delivered).toBe(true)
        expect(result.metadata.redelivered).toBe(false)
        expect(result.metadata.status).toBe("running")

        const messages = await Session.messages({ sessionID: child.id })
        const delivered = controlTexts(messages, "narrow the scope to src/")
        expect(delivered).toHaveLength(1)
        expect(
          delivered[0].parts.some((part) => part.type === "text" && part.text.includes("<background_task_message")),
        ).toBe(true)

        // The prompt loop was nudged so the child actually processes it.
        expect(nudge).toHaveBeenCalledTimes(1)
        expect(nudge).toHaveBeenCalledWith(child.id)

        // The ledger records the delivery (ADR-057 guard).
        const latest = await TaskQueue.get(TaskQueueID.make(item.id))
        const entries = TaskQueue.controlDeliveries(latest)
        expect(entries).toHaveLength(1)
        expect(entries[0].status).toBe("delivered")
        expect(entries[0].messageID).toBe(result.metadata.messageID)
      },
    })
  })

  test("redelivery after a mid-flight crash converges to exactly one message", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        stubNudge()
        const parent = await Session.create({})
        const { child, item } = await enqueueBackgroundSubagent({
          parent: parent.id,
          status: "running",
          initialPrompt: "do the original task",
        })

        // Simulate a kill after the message was persisted but before the
        // ledger entry flipped to delivered: the "delivered" write fails once.
        const real = TaskQueue.setControlDelivery
        let killed = false
        vi.spyOn(TaskQueue, "setControlDelivery").mockImplementation(async (input) => {
          if (input.status === "delivered" && !killed) {
            killed = true
            throw new Error("simulated mid-flight crash")
          }
          return real(input)
        })

        await expect(
          (await MessageBackgroundTaskTool.init()).execute(
            { task_id: item.id, message: "also cover the tests" },
            toolContext(parent.id),
          ),
        ).rejects.toThrow("simulated mid-flight crash")

        let latest = await TaskQueue.get(TaskQueueID.make(item.id))
        const pendingEntry = TaskQueue.controlDeliveries(latest)[0]
        expect(pendingEntry.status).toBe("pending")
        const afterCrash = controlTexts(await Session.messages({ sessionID: child.id }), "also cover the tests")
        expect(afterCrash).toHaveLength(1)
        const originalCreated = afterCrash[0]?.info.time.created

        vi.restoreAllMocks()
        // Restore the nudge stub cleared by restoreAllMocks (it was assigned,
        // not spied, so re-stub explicitly).
        stubNudge()

        const retry = await (
          await MessageBackgroundTaskTool.init()
        ).execute({ task_id: item.id, message: "also cover the tests" }, toolContext(parent.id))

        expect(retry.metadata.delivered).toBe(true)
        expect(retry.metadata.redelivered).toBe(true)
        // Same message id reused — the upsert converged, no duplicate.
        expect(retry.metadata.messageID).toBe(pendingEntry.messageID)
        const afterRetry = controlTexts(await Session.messages({ sessionID: child.id }), "also cover the tests")
        expect(afterRetry).toHaveLength(1)
        // Redelivery must not drift the recorded send time.
        expect(afterRetry[0]?.info.time.created).toBe(originalCreated)

        latest = await TaskQueue.get(TaskQueueID.make(item.id))
        expect(TaskQueue.controlDeliveries(latest)).toHaveLength(1)
        expect(TaskQueue.controlDeliveries(latest)[0].status).toBe("delivered")
      },
    })
  })

  test("messaging a finished task returns its terminal status and injects nothing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        stubNudge()
        const parent = await Session.create({})
        const { child, item } = await enqueueBackgroundSubagent({
          parent: parent.id,
          status: "completed",
          title: "finished task",
          initialPrompt: "original prompt",
        })
        const before = await Session.messages({ sessionID: child.id })

        const result = await (
          await MessageBackgroundTaskTool.init()
        ).execute({ task_id: item.id, message: "too late" }, toolContext(parent.id))

        expect(result.metadata.delivered).toBe(false)
        expect(result.metadata.status).toBe("completed")
        expect(result.output).toContain("state: completed")
        expect(result.output).toContain("NOT delivered")

        const after = await Session.messages({ sessionID: child.id })
        expect(after).toHaveLength(before.length)
        expect(controlTexts(after, "too late")).toHaveLength(0)
        expect(nudge).not.toHaveBeenCalled()

        const latest = await TaskQueue.get(TaskQueueID.make(item.id))
        expect(TaskQueue.controlDeliveries(latest)).toHaveLength(0)
      },
    })
  })

  test("refuses unknown, foreign, and non-background targets", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        stubNudge()
        const caller = await Session.create({})
        const other = await Session.create({})
        const foreign = await enqueueBackgroundSubagent({ parent: other.id, status: "running" })
        const plain = await TaskQueue.enqueue({ sessionID: caller.id, kind: "prompt", title: "plain queue item" })

        await expect(
          (await MessageBackgroundTaskTool.init()).execute(
            { task_id: TaskQueueID.make("tsk_doesnotexist"), message: "hi" },
            toolContext(caller.id),
          ),
        ).rejects.toThrow(/No background task found/)

        await expect(
          (await MessageBackgroundTaskTool.init()).execute(
            { task_id: foreign.item.id, message: "hi" },
            toolContext(caller.id),
          ),
        ).rejects.toThrow(/was not started from this session/)

        await expect(
          (await MessageBackgroundTaskTool.init()).execute(
            { task_id: plain.id, message: "hi" },
            toolContext(caller.id),
          ),
        ).rejects.toThrow(/is not a background task/)

        // None of the refusals injected anything or nudged a loop.
        expect(controlTexts(await Session.messages({ sessionID: foreign.child.id }), "hi")).toHaveLength(0)
        expect(nudge).not.toHaveBeenCalled()
      },
    })
  })
})
