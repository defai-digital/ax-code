import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import {
  BackgroundSubagentDeliveryInternals,
  deliverBackgroundSubagentHandoff,
  recoverBackgroundSubagentHandoffs,
} from "../../src/session/background-subagent-delivery"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { syntheticTextPart } from "../../src/session/prompt-message-builders"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { TaskQueue } from "../../src/session/task-queue"
import { WaitForTool } from "../../src/tool/waitfor"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  BackgroundSubagentDeliveryInternals.afterPersist = async () => {}
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

function toolContext(sessionID: SessionID, callID: string) {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    callID,
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
    extra: {},
  } as any
}

async function createCompletedBackgroundTask(parentID: SessionID, directory: string, text: string) {
  const child = await Session.create({ parentID })
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID: child.id,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test" as any, modelID: "test-model" as any },
  } as MessageV2.User)
  const assistant = await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: user.id,
    sessionID: child.id,
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
  await Session.updatePart(syntheticTextPart({ messageID: assistant.id, sessionID: child.id, text }))

  const queued = await TaskQueue.enqueue({
    sessionID: child.id,
    kind: "subagent",
    title: "background task",
    payload: {
      source: "task",
      resumeOnRestart: true,
      deliveryStatus: "pending",
      parentSessionID: parentID,
    },
  })
  const item = await TaskQueue.setStatus({ id: queued.id, status: "completed" })
  return { child, item, outcome: { status: "completed" as const, result: { parts: [{ type: "text", text }] } } }
}

async function handoffParts(parentID: SessionID) {
  return (await Session.messages({ sessionID: parentID }))
    .flatMap((message) => message.parts)
    .filter(
      (part): part is MessageV2.TextPart =>
        part.type === "text" && part.metadata?.["source"] === "background_subagent_handoff",
    )
}

describe("background subagent result delivery", () => {
  test("waitfor and automatic handoff select exactly one result consumer", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const task = await createCompletedBackgroundTask(parent.id, tmp.path, "race-safe result")
        vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)

        const [waited] = await Promise.all([
          (await WaitForTool.init()).execute(
            { task_id: task.item.id, timeout: 30 },
            toolContext(parent.id, "call_waitfor_race"),
          ),
          deliverBackgroundSubagentHandoff({ item: task.item, outcome: task.outcome }),
        ])

        const parentHandoffs = await handoffParts(parent.id)
        const waitforDeliveredResult = waited.output.includes("<task_result>")
        expect(Number(waitforDeliveredResult) + parentHandoffs.length).toBe(1)
        const latest = await TaskQueue.get(task.item.id)
        const claim = TaskQueue.resultDeliveryClaim(latest)
        if (claim?.owner === "waitfor") {
          await TaskQueue.completeResultDelivery({ id: task.item.id, claim })
        }
        expect((await TaskQueue.get(task.item.id)).payload["deliveryStatus"]).toBe("delivered")
      },
    })
  })

  test("recovery reuses stable handoff ids after persistence fails mid-flight", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const task = await createCompletedBackgroundTask(parent.id, tmp.path, "recoverable result")
        vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)
        BackgroundSubagentDeliveryInternals.afterPersist = async () => {
          throw new Error("simulated crash boundary")
        }

        const blocked = await deliverBackgroundSubagentHandoff({ item: task.item, outcome: task.outcome })
        const firstClaim = TaskQueue.resultDeliveryClaim(blocked)
        expect(blocked.payload["deliveryStatus"]).toBe("blocked")
        expect(firstClaim?.owner).toBe("handoff")
        expect(await handoffParts(parent.id)).toHaveLength(1)

        BackgroundSubagentDeliveryInternals.afterPersist = async () => {}
        const recovered = await recoverBackgroundSubagentHandoffs()

        expect(recovered.delivered).toBe(1)
        const latest = await TaskQueue.get(task.item.id)
        expect(latest.payload["deliveryStatus"]).toBe("delivered")
        expect(TaskQueue.resultDeliveryClaim(latest)).toEqual(firstClaim)
        const parts = await handoffParts(parent.id)
        expect(parts).toHaveLength(1)
        expect(parts[0]?.text).toContain("recoverable result")
      },
    })
  })

  test("recovery replaces a waitfor claim whose tool result never reached the session log", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const task = await createCompletedBackgroundTask(parent.id, tmp.path, "orphaned wait result")
        vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)
        await TaskQueue.claimResultDelivery({
          id: task.item.id,
          claim: {
            owner: "waitfor",
            sessionID: parent.id,
            messageID: MessageID.make("msg_missing_waitfor_result"),
            callID: "call_missing_waitfor_result",
            time: Date.now(),
          },
        })

        const recovered = await recoverBackgroundSubagentHandoffs()

        expect(recovered.delivered).toBe(1)
        const latest = await TaskQueue.get(task.item.id)
        expect(latest.payload["deliveryStatus"]).toBe("delivered")
        expect(TaskQueue.resultDeliveryClaim(latest)?.owner).toBe("handoff")
        const parts = await handoffParts(parent.id)
        expect(parts).toHaveLength(1)
        expect(parts[0]?.text).toContain("orphaned wait result")
      },
    })
  })

  test("recovery preserves a waitfor claim whose completed tool result is durable", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const task = await createCompletedBackgroundTask(parent.id, tmp.path, "durable wait result")
        vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: parent.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test" as any, modelID: "test-model" as any },
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: parent.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
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
        const callID = "call_durable_waitfor_result"
        await TaskQueue.claimResultDelivery({
          id: task.item.id,
          claim: {
            owner: "waitfor",
            sessionID: parent.id,
            messageID: assistant.id,
            callID,
            time: Date.now(),
          },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: assistant.id,
          sessionID: parent.id,
          type: "tool",
          tool: "waitfor",
          callID,
          state: {
            status: "completed",
            input: { task_id: task.item.id, timeout: 30 },
            output: "durable wait result",
            title: "background task",
            metadata: { taskID: task.item.id, delivered: true },
            time: { start: Date.now(), end: Date.now() },
          },
        })

        const recovered = await recoverBackgroundSubagentHandoffs()

        expect(recovered.preserved).toBe(1)
        expect(recovered.delivered).toBe(0)
        expect((await TaskQueue.get(task.item.id)).payload["deliveryStatus"]).toBe("delivered")
        expect(await handoffParts(parent.id)).toHaveLength(0)
      },
    })
  })
})
