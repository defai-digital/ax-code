import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, TaskQueueID, type SessionID } from "../../src/session/schema"
import { syntheticTextPart } from "../../src/session/prompt-message-builders"
import { TaskQueue } from "../../src/session/task-queue"
import { WaitForInternals, WaitForTool } from "../../src/tool/waitfor"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  WaitForInternals.pollIntervalMs = 1000
  await Instance.disposeAll()
})

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

async function writeAssistantResult(sessionID: SessionID, directory: string, text: string) {
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test" as any, modelID: "test-model" as any },
    tools: {},
    mode: "build",
  } as any)
  const assistant = await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: user.id,
    sessionID,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: "test-model",
    providerID: "test",
    time: { created: Date.now(), completed: Date.now() },
  } as MessageV2.Assistant)
  await Session.updatePart(syntheticTextPart({ messageID: assistant.id, sessionID, text }))
}

async function enqueueBackgroundSubagent(input: {
  parent: SessionID
  directory: string
  resultText?: string
  status?: TaskQueue.Status
}) {
  const child = await Session.create({ parentID: input.parent })
  if (input.resultText !== undefined) {
    await writeAssistantResult(child.id, input.directory, input.resultText)
  }
  const item = await TaskQueue.enqueue({
    sessionID: child.id,
    kind: "subagent",
    title: "background task",
    payload: {
      source: "task",
      resumeOnRestart: true,
      deliveryStatus: "pending",
      parentSessionID: input.parent,
    },
  })
  const status = input.status ?? "completed"
  if (status !== "queued") {
    return { child, item: await TaskQueue.setStatus({ id: item.id, status }) }
  }
  return { child, item }
}

describe("tool.waitfor", () => {
  test("completed target claims the child result and suppresses the handoff", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const { child, item } = await enqueueBackgroundSubagent({
          parent: parent.id,
          directory: tmp.path,
          resultText: "background findings",
        })

        const result = await (
          await WaitForTool.init()
        ).execute({ task_id: item.id, timeout: 30 }, toolContext(parent.id))

        expect(result.output).toContain("state: completed")
        expect(result.output).toContain("background findings")
        expect(result.metadata.timedOut).toBe(false)
        expect(result.metadata.delivered).toBe(true)
        // task_id echoes the queue item id — the same id form the timeout
        // path uses; the child session id is a separate field.
        expect(result.output).toContain(`task_id: ${item.id}`)
        expect(result.output).toContain(`session_id: ${child.id}`)

        const latest = await TaskQueue.get(TaskQueueID.make(item.id))
        expect(latest.payload["deliveryStatus"]).toBe("delivering")
        expect(TaskQueue.resultDeliveryClaim(latest)?.owner).toBe("waitfor")

        // The handoff path's delivery guard must now suppress the automatic
        // completion message — no duplicate <task id=...> in the parent.
        const { deliverBackgroundSubagentHandoff } = await import("../../src/session/background-subagent-delivery")
        await deliverBackgroundSubagentHandoff({
          item: latest,
          outcome: { status: "completed", result: { parts: [{ type: "text", text: "background findings" }] } },
        })
        const parentMessages = await Session.messages({ sessionID: parent.id })
        const handoff = parentMessages
          .flatMap((message) => message.parts)
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .find((text) => text.includes("<task id="))
        expect(handoff).toBeUndefined()

        const claim = TaskQueue.resultDeliveryClaim(latest)
        expect(claim?.owner).toBe("waitfor")
        if (claim?.owner === "waitfor") {
          await TaskQueue.completeResultDelivery({ id: item.id, claim })
        }
        expect((await TaskQueue.get(item.id)).payload["deliveryStatus"]).toBe("delivered")
      },
    })
  })

  test("already-delivered target resolves by child session id without duplicating the result", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const { child, item } = await enqueueBackgroundSubagent({
          parent: parent.id,
          directory: tmp.path,
          resultText: "already delivered text",
        })
        await TaskQueue.setDelivery({ id: item.id, status: "delivered" })

        const result = await (
          await WaitForTool.init()
        ).execute({ task_id: child.id, timeout: 30 }, toolContext(parent.id))

        expect(result.output).not.toContain("already delivered text")
        expect(result.output).toContain("already delivered")
        expect(result.metadata.delivered).toBe(false)
        expect(result.metadata.taskID).toBe(item.id)
        expect(result.output).toContain(`task_id: ${item.id}`)
      },
    })
  })

  test("fails fast on a target gated on the caller's own session going idle", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const item = await TaskQueue.enqueue({
          sessionID: parent.id,
          kind: "prompt",
          title: "queued on caller session",
        })
        await TaskQueue.setStatus({ id: item.id, status: "waiting_for_idle" })

        await expect(
          (await WaitForTool.init()).execute({ task_id: item.id, timeout: 30 }, toolContext(parent.id)),
        ).rejects.toThrow(/deadlock/)
      },
    })
  })

  test("fails fast when the target transitions to waiting_for_idle mid-wait", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        // Starts as "queued" so the pre-loop idle-gate check passes, then
        // flips to waiting_for_idle while waitfor is polling — the re-check
        // inside the poll loop must catch it instead of deadlocking until
        // the timeout.
        const item = await TaskQueue.enqueue({
          sessionID: parent.id,
          kind: "prompt",
          title: "queued on caller session",
        })

        WaitForInternals.pollIntervalMs = 25
        const wait = (await WaitForTool.init()).execute({ task_id: item.id, timeout: 30 }, toolContext(parent.id))
        await new Promise((resolve) => setTimeout(resolve, 60))
        await TaskQueue.setStatus({ id: item.id, status: "waiting_for_idle" })

        await expect(wait).rejects.toThrow(/deadlock/)
      },
    })
  })

  test("session-id resolution picks the newest subagent queue item, not list order", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const { child, item: older } = await enqueueBackgroundSubagent({
          parent: parent.id,
          directory: tmp.path,
          resultText: "latest result",
        })
        // A second subagent queue item on the SAME child session.
        const newer = await TaskQueue.setStatus({
          id: (
            await TaskQueue.enqueue({
              sessionID: child.id,
              kind: "subagent",
              title: "second background task",
              payload: { source: "task", deliveryStatus: "pending", parentSessionID: parent.id },
            })
          ).id,
          status: "completed",
        })
        // Move the newer item to the FRONT of the queue so list order ends
        // with the stale row — a `.at(-1)` pick would resolve the old item.
        await TaskQueue.reorder({ id: newer.id, position: 0 })
        expect(older.id).not.toBe(newer.id)

        const result = await (
          await WaitForTool.init()
        ).execute({ task_id: child.id, timeout: 30 }, toolContext(parent.id))

        expect(result.metadata.taskID).toBe(newer.id)
        expect(result.output).toContain(`task_id: ${newer.id}`)
        expect(result.output).toContain("latest result")
      },
    })
  })

  test("timeout returns a recoverable non-error result", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const { item } = await enqueueBackgroundSubagent({
          parent: parent.id,
          directory: tmp.path,
          status: "running",
        })

        WaitForInternals.pollIntervalMs = 25
        const result = await (
          await WaitForTool.init()
        ).execute({ task_id: item.id, timeout: 1 }, toolContext(parent.id))

        expect(result.metadata.timedOut).toBe(true)
        expect(result.metadata.status).toBe("running")
        expect(result.output).toContain("Still running after 1s")
        expect(result.output).toContain(`task_id=${item.id}`)
        expect(result.output).toContain("you will be notified when it finishes")
      },
    })
  })

  test("unknown target errors", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})

        await expect(
          (await WaitForTool.init()).execute(
            { task_id: TaskQueueID.make("tsk_doesnotexist"), timeout: 5 },
            toolContext(parent.id),
          ),
        ).rejects.toThrow(/No background task found/)

        await expect((await WaitForTool.init()).execute({ timeout: 5 }, toolContext(parent.id))).rejects.toThrow(
          /task_id is required/,
        )
      },
    })
  })

  test("target outside the caller's session tree errors", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const caller = await Session.create({})
        const otherRoot = await Session.create({})
        const { item } = await enqueueBackgroundSubagent({
          parent: otherRoot.id,
          directory: tmp.path,
          resultText: "other tree result",
        })

        await expect(
          (await WaitForTool.init()).execute({ task_id: item.id, timeout: 5 }, toolContext(caller.id)),
        ).rejects.toThrow(/outside this session's tree/)
      },
    })
  })
})
