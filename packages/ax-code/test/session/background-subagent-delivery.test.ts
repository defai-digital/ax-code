import { mkdir } from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import {
  BackgroundSubagentDeliveryInternals,
  deliverBackgroundSubagentHandoff,
  nestedSubagentWork,
  recoverBackgroundSubagentHandoffs,
  waitForNestedSubagentResults,
} from "../../src/session/background-subagent-delivery"
import { SessionCompaction } from "../../src/session/compaction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionSummary } from "../../src/session/summary"
import { syntheticTextPart } from "../../src/session/prompt/prompt-message-builders"
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
  test.each([false, true])(
    "a background handoff preserves the active parent turn's fallback route (separate worker: %s)",
    async (crossDirectory) => {
      const providerID = ProviderID.make("fixture")
      const primary = ModelID.make("primary")
      const original = ModelID.make("original")
      const edited = ModelID.make("edited")
      const card = { tool_call: true, limit: { context: 128_000, output: 8_192 } }
      await using tmp = await tmpdir({
        git: true,
        config: {
          enabled_providers: [providerID],
          provider: {
            [providerID]: {
              npm: "@ai-sdk/openai-compatible",
              api: "https://fixture.invalid/v1",
              models: { [primary]: card, [original]: card, [edited]: card },
            },
          },
        },
      })

      const workerDirectory = path.join(tmp.path, "worker")
      if (crossDirectory) await mkdir(workerDirectory)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          config.llm_routing = { fallback: [{ providerID, modelID: original }] }
          const parent = await Session.create({ title: "Live handoff route" })
          const task = await createCompletedBackgroundTask(parent.id, tmp.path, "Child result")
          const targets: ModelID[] = []
          const response = (text?: string) =>
            ({
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "start-step" }
                if (text) {
                  yield { type: "text-start", id: "response" }
                  yield { type: "text-delta", id: "response", text }
                  yield { type: "text-end", id: "response" }
                }
                yield {
                  type: "finish-step",
                  finishReason: "stop",
                  usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
                }
                yield { type: "finish" }
              })(),
            }) as unknown as Awaited<ReturnType<typeof LLM.stream>>
          vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
          vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
            if (input.small) return response("Fixture title")
            targets.push(input.model.id)
            if (targets.length === 1) {
              config.llm_routing = { fallback: [{ providerID, modelID: edited }] }
              const deliver = () => deliverBackgroundSubagentHandoff(task)
              const delivered = crossDirectory
                ? await Instance.provide({ directory: workerDirectory, fn: deliver })
                : await deliver()
              expect(delivered.payload["deliveryStatus"]).toBe("delivered")
              return response()
            }
            if (input.model.id === primary) {
              throw new MessageV2.APIError({
                message: "Primary unavailable",
                statusCode: 503,
                isRetryable: false,
                metadata: { retryExhausted: "true" },
              })
            }
            return response("Fallback answered")
          })

          await SessionPrompt.prompt({
            sessionID: parent.id,
            model: { providerID, modelID: primary },
            agent: "build",
            parts: [{ type: "text", text: "Continue the current work." }],
          })

          expect(await handoffParts(parent.id)).toHaveLength(1)
          expect(targets.slice(0, 3)).toEqual([primary, primary, original])
        },
      })
    },
  )

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

  test.each([false, true])(
    "wakes the parent in its own directory despite unrelated queue work (cold: %s)",
    async (coldParent) => {
      await using tmp = await tmpdir({ git: true })
      const workerDirectory = path.join(tmp.path, "worker")
      await mkdir(workerDirectory)
      const provide = coldParent ? Instance.provideScoped : Instance.provide
      const { parent, task } = await provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({})
          const task = await createCompletedBackgroundTask(parent.id, tmp.path, "root result")
          const unrelated = await TaskQueue.enqueue({
            sessionID: parent.id,
            kind: "prompt",
            title: "unrelated active prompt",
            payload: {},
          })
          await TaskQueue.setStatus({ id: unrelated.id, status: "running" })
          return { parent, task }
        },
      })
      expect(Instance.list().includes(parent.directory)).toBe(!coldParent)

      const wakes = vi.fn()
      vi.spyOn(SessionPrompt, "loop").mockImplementation(async ({ sessionID }) => {
        const row = await TaskQueue.get(task.item.id)
        wakes({ sessionID, directory: Instance.directory, deliveryStatus: row.payload["deliveryStatus"] })
        return undefined as never
      })

      const delivered = await Instance.provide({
        directory: workerDirectory,
        fn: () => deliverBackgroundSubagentHandoff(task),
      })

      expect(delivered.payload["deliveryStatus"]).toBe("delivered")
      await vi.waitFor(() =>
        expect(wakes).toHaveBeenCalledExactlyOnceWith({
          sessionID: parent.id,
          directory: parent.directory,
          deliveryStatus: "delivered",
        }),
      )
    },
  )

  test("a result consumed by waitfor does not require another synthesis turn", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const task = await createCompletedBackgroundTask(parent.id, tmp.path, "consumed result")
        const claim = {
          owner: "waitfor" as const,
          sessionID: parent.id,
          messageID: MessageID.ascending(),
          callID: "call_waitfor_consumed",
          time: Date.now(),
        }
        await TaskQueue.claimResultDelivery({ id: task.item.id, claim })
        await TaskQueue.completeResultDelivery({ id: task.item.id, claim })

        const work = await nestedSubagentWork({ sessionID: parent.id, since: Date.now() - 1000 })
        expect(work).toEqual({ pending: false, settled: false })
      },
    })
  })

  test("finds a current child result beyond unrelated queue history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const task = await createCompletedBackgroundTask(parent.id, tmp.path, "current child result")
        const since = Date.now() - 1000
        expect(await nestedSubagentWork({ sessionID: parent.id, since })).toEqual({ pending: true, settled: true })
        vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)
        await deliverBackgroundSubagentHandoff(task)

        for (let index = 0; index < 201; index++) {
          const unrelated = await TaskQueue.enqueue({
            sessionID: parent.id,
            kind: "prompt",
            title: `unrelated prompt ${index}`,
            payload: {},
          })
          await TaskQueue.setStatus({ id: unrelated.id, status: "completed" })
        }

        const work = await nestedSubagentWork({ sessionID: parent.id, since })
        expect(work).toEqual({ pending: false, settled: true })
      },
    })
  })

  test("bounds and aborts a nested result wait", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const child = await Session.create({ parentID: parent.id })
        await TaskQueue.enqueue({
          sessionID: child.id,
          kind: "subagent",
          title: "pending nested task",
          payload: { source: "task", deliveryStatus: "pending", parentSessionID: parent.id },
        })

        await expect(waitForNestedSubagentResults({ sessionID: parent.id, timeoutMs: 1 })).resolves.toBe("timeout")
        const controller = new AbortController()
        const waiting = waitForNestedSubagentResults({
          sessionID: parent.id,
          timeoutMs: 10_000,
          signal: controller.signal,
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
        controller.abort()
        await expect(waiting).rejects.toMatchObject({ name: "AbortError" })
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

  test("recovery delivers a cancelled background result", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({})
        const task = await createCompletedBackgroundTask(parent.id, tmp.path, "unused result")
        vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)
        const cancelled = await TaskQueue.setStatus({
          id: task.item.id,
          status: "cancelled",
          error: "Stopped by operator.",
        })
        expect(cancelled.status).toBe("cancelled")

        const recovered = await recoverBackgroundSubagentHandoffs()

        expect(recovered.delivered).toBe(1)
        const latest = await TaskQueue.get(task.item.id)
        expect(latest.payload["deliveryStatus"]).toBe("delivered")
        const parts = await handoffParts(parent.id)
        expect(parts).toHaveLength(1)
        expect(parts[0]?.text).toContain("Stopped by operator.")
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

test.each([false, true])("background handoffs retain user settings during compaction (%s)", async (compacting) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.create({})
      const task = await createCompletedBackgroundTask(parent.id, tmp.path, "Inspection complete.")
      const settings = {
        tools: { bash: false, edit: false },
        isolation: { mode: "read-only" as const, network: false },
        system: "Keep the current workspace unchanged.",
        format: { type: "json_schema" as const, schema: { type: "object" }, retryCount: 2 },
        variant: "high",
        requestedDepth: "deep" as const,
      }
      const source = await Session.updateMessage({
        id: MessageID.ascending(),
        sessionID: parent.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "test" as never, modelID: "test-model" as never },
        ...settings,
      })
      if (source.role !== "user") throw new Error("Expected user source")
      if (compacting)
        await SessionCompaction.create({ sessionID: parent.id, agent: source.agent, model: source.model, auto: true })
      vi.spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)
      await deliverBackgroundSubagentHandoff({ item: task.item, outcome: task.outcome })
      const users = (await Session.messages({ sessionID: parent.id })).filter((m) => m.info.role === "user")
      expect(users).toHaveLength(compacting ? 3 : 2)
      expect(users.at(-1)!.info.id).not.toBe(source.id)
      expect(users.at(-1)!.info).toMatchObject(settings)
      expect(users.at(-1)!.parts[0]).toMatchObject({ type: "text", synthetic: true })
    },
  })
})
