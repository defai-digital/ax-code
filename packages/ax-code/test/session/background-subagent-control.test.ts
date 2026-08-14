import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { TaskQueue } from "../../src/session/task-queue"
import { MessageID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { MAX_BACKGROUND_SUBAGENTS, TaskTool } from "../../src/tool/task"
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
  limit: { context: 128_000, output: 8_192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

let streamSpy: MockInstance | undefined
let modelSpy: MockInstance | undefined
let summarySpy: MockInstance | undefined

afterEach(async () => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  modelSpy?.mockRestore()
  modelSpy = undefined
  summarySpy?.mockRestore()
  summarySpy = undefined
  await Instance.disposeAll()
})

describe("background subagent control", () => {
  test("aborting the parent cancels busy children and their queue rows", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = vi.spyOn(SessionSummary, "summarize").mockResolvedValue()

    let readyResolve!: () => void
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve
    })
    streamSpy = vi.spyOn(LLM, "stream").mockImplementation(async (input) => {
      return {
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "start-step" }
          yield { type: "text-start", id: "text_1" }
          yield { type: "text-delta", id: "text_1", text: "child working" }
          readyResolve()
          await new Promise((_, reject) => {
            input.abort.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
              once: true,
            })
          })
        })(),
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "Parent" })
        const child = await Session.create({ parentID: parent.id, title: "Child" })
        const queued = await TaskQueue.enqueue({
          sessionID: child.id,
          kind: "subagent",
          title: "Explore",
          payload: { source: "task", resumeOnRestart: true, prompt: "find auth" },
        })
        await TaskQueue.setStatus({ id: queued.id, status: "running" })

        const pending = SessionPrompt.prompt({
          sessionID: child.id,
          agent: "explore",
          parts: [{ type: "text", text: "find auth" }],
        })
        await ready
        await SessionPrompt.cancel(parent.id)
        await pending.catch(() => undefined)

        expect(await SessionStatus.get(child.id)).toEqual({ type: "idle" })
        expect((await TaskQueue.get(queued.id)).status).toBe("cancelled")
      },
    })
  })

  test("rejects a new background spawn when the parent already has the max active children", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "Parent" })
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: parent.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test" as any, modelID: "test-model" as any },
        } as any)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: parent.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test-model",
          providerID: "test",
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        for (let index = 0; index < MAX_BACKGROUND_SUBAGENTS; index++) {
          const child = await Session.create({ parentID: parent.id, title: `Child ${index}` })
          const item = await TaskQueue.enqueue({
            sessionID: child.id,
            kind: "subagent",
            title: `Active ${index}`,
            payload: { source: "task", resumeOnRestart: true },
          })
          await TaskQueue.setStatus({ id: item.id, status: "running" })
        }

        await expect(
          (
            await TaskTool.init()
          ).execute(
            {
              description: "One more",
              prompt: "do more work",
              subagent_type: "explore",
              background: true,
            },
            {
              sessionID: parent.id,
              messageID: assistant.id,
              callID: "",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => {},
              ask: async () => {},
              extra: {},
            } as any,
          ),
        ).rejects.toThrow(/Maximum concurrent background subagents/)
      },
    })
  })
})
