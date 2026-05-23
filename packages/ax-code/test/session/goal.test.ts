import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: "test-model" as any,
  providerID: "test" as any,
  name: "Test",
  family: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: {
    context: 128_000,
    output: 8_192,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

let streamSpy: ReturnType<typeof spyOn> | undefined
let modelSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  modelSpy?.mockRestore()
  modelSpy = undefined
})

describe("SessionGoal", () => {
  test("persists lifecycle and budget usage per session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const created = await SessionGoal.create({
          sessionID: session.id,
          objective: "finish the migration",
          tokenBudget: 25,
        })

        expect(created.status).toBe("active")
        expect(created.tokensUsed).toBe(0)
        expect(created.tokenBudget).toBe(25)

        const updated = await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_usage" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 3_000 },
            modelID: "test-model" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: {
              total: 30,
              input: 10,
              output: 15,
              reasoning: 5,
              cache: { read: 0, write: 0 },
            },
          },
        })

        expect(updated?.status).toBe("budget_limited")
        expect(updated?.tokensUsed).toBe(30)
        expect(updated?.timeUsedSeconds).toBe(2)

        await SessionGoal.clear(session.id)
        expect(await SessionGoal.get(session.id)).toBeUndefined()
        await Session.remove(session.id)
      },
    })
  })

  test("adds concurrent usage updates without losing increments", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({
          sessionID: session.id,
          objective: "track concurrent usage",
          tokenBudget: 100,
        })

        const message = (id: string, total: number, created: number, completed: number) => ({
          id: id as any,
          sessionID: session.id,
          parentID: "message_parent" as any,
          role: "assistant" as const,
          time: { created, completed },
          modelID: "test-model" as any,
          providerID: "test" as any,
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: {
            total,
            input: 0,
            output: total,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })

        await Promise.all([
          SessionGoal.addUsage({ sessionID: session.id, message: message("message_goal_usage_a", 30, 1_000, 3_000) }),
          SessionGoal.addUsage({ sessionID: session.id, message: message("message_goal_usage_b", 40, 4_000, 7_000) }),
        ])

        const updated = await SessionGoal.get(session.id)
        expect(updated?.status).toBe("active")
        expect(updated?.tokensUsed).toBe(70)
        expect(updated?.timeUsedSeconds).toBe(5)

        await SessionGoal.addUsage({
          sessionID: session.id,
          message: message("message_goal_usage_c", 30, 8_000, 9_000),
        })

        const limited = await SessionGoal.get(session.id)
        expect(limited?.status).toBe("budget_limited")
        expect(limited?.tokensUsed).toBe(100)
        expect(limited?.timeUsedSeconds).toBe(6)

        await Session.remove(session.id)
      },
    })
  })

  test("goal command controls lifecycle without invoking the model for view and pause", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "ship the goal command" })
        modelSpy = spyOn(Provider, "getModel").mockResolvedValue(model)
        streamSpy = spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {})(),
        } as any)

        const view = await SessionPrompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: "",
          agent: "build",
          model: "test/test-model",
        })
        expect(view.parts.some((part) => part.type === "text" && part.text.includes("ship the goal command"))).toBe(
          true,
        )

        const paused = await SessionPrompt.command({
          sessionID: session.id,
          command: "goal",
          arguments: "pause",
          agent: "build",
          model: "test/test-model",
        })
        expect(paused.parts.some((part) => part.type === "text" && part.text.includes("Goal paused"))).toBe(true)
        expect(streamSpy).not.toHaveBeenCalled()

        await Session.remove(session.id)
      },
    })
  })

  test("active goal schedules a bounded continuation after an ordinary stop", async () => {
    await using tmp = await tmpdir({ git: true, config: { session: { max_continuations: 1 } } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "finish the durable goal" })
        modelSpy = spyOn(Provider, "getModel").mockResolvedValue(model)
        let streams = 0
        streamSpy = spyOn(LLM, "stream").mockImplementation((async () => {
          streams++
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield { type: "text-start", id: `text_${streams}` }
              yield { type: "text-delta", id: `text_${streams}`, text: `turn ${streams}` }
              yield { type: "text-end", id: `text_${streams}` }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              }
              yield { type: "finish" }
            })(),
          } as any
        }) as any)

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [{ type: "text", text: "start work" }],
        })

        expect(streamSpy?.mock.calls.length ?? 0).toBeGreaterThan(1)
        const messages = await Session.messages({ sessionID: session.id })
        expect(
          messages.some((message) =>
            message.parts.some((part) => part.type === "text" && part.text.includes("goal auto-continuation 1/1")),
          ),
        ).toBe(true)

        await Session.remove(session.id)
      },
    })
  })
})
