import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { Database } from "../../src/storage/db"
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
  cost: {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
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
let summarySpy: ReturnType<typeof spyOn> | undefined
let trackSpy: ReturnType<typeof spyOn> | undefined
let patchSpy: ReturnType<typeof spyOn> | undefined

afterEach(async () => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  modelSpy?.mockRestore()
  modelSpy = undefined
  summarySpy?.mockRestore()
  summarySpy = undefined
  trackSpy?.mockRestore()
  trackSpy = undefined
  patchSpy?.mockRestore()
  patchSpy = undefined
})

describe("session.prompt flow", () => {
  test("persists text reply and survives instance reload", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue()
    streamSpy = spyOn(LLM, "stream").mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "start-step" }
        yield { type: "text-start", id: "text_1" }
        yield { type: "text-delta", id: "text_1", text: "hello from flow" }
        yield { type: "text-end", id: "text_1" }
        yield {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }
        yield { type: "finish" }
      })(),
    } as any)

    let sessionID: string

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Prompt Flow Test" })
        sessionID = session.id

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "say hello" }],
        })

        expect(msg.info.role).toBe("assistant")
        expect(msg.parts.some((part) => part.type === "text" && part.text.includes("hello from flow"))).toBe(true)
        expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })

        const before = await Session.messages({ sessionID: session.id })
        expect(before).toHaveLength(2)
        expect(before[0]?.info.role).toBe("user")
        expect(before[1]?.info.role).toBe("assistant")
      },
    })

    await Instance.disposeAll()
    Database.close()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const after = await Session.messages({ sessionID: sessionID! as any })
        expect(after).toHaveLength(2)
        expect(after[1]?.parts.some((part) => part.type === "text" && part.text.includes("hello from flow"))).toBe(true)
        await Session.remove(sessionID! as any)
      },
    })
  })

  test("persists tool and patch parts for a tool-using step", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue()
    trackSpy = spyOn(Snapshot, "track").mockResolvedValue("snap-1")
    patchSpy = spyOn(Snapshot, "patch").mockResolvedValue({
      hash: "snap-1",
      files: [path.join(tmp.path, "src/file.ts")],
    })
    streamSpy = spyOn(LLM, "stream").mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "start-step" }
        yield { type: "tool-input-start", id: "call_1", toolName: "read" }
        yield { type: "tool-call", toolCallId: "call_1", toolName: "read", input: { file: "src/file.ts" } }
        yield {
          type: "tool-result",
          toolCallId: "call_1",
          input: { file: "src/file.ts" },
          output: {
            output: "file body",
            title: "Read src/file.ts",
            metadata: {},
            attachments: [],
          },
        }
        yield {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        }
        yield { type: "finish" }
      })(),
    } as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Prompt Tool Flow Test" })

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "inspect file" }],
        })

        expect(msg.info.role).toBe("assistant")

        const stored = await Session.messages({ sessionID: session.id })
        expect(stored[1]?.parts.some((part) => part.type === "tool" && part.state.status === "completed")).toBe(true)
        expect(stored[1]?.parts.some((part) => part.type === "step-start")).toBe(true)
        expect(stored[1]?.parts.some((part) => part.type === "step-finish" && part.reason === "tool-calls")).toBe(true)
        expect(stored[1]?.parts.some((part) => part.type === "patch" && part.hash === "snap-1")).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("persists partial assistant text on cancel and allows later recovery", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue()

    let call = 0
    let readyResolve!: () => void
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve
    })

    streamSpy = spyOn(LLM, "stream").mockImplementation(async (input) => {
      call++
      if (call === 1) {
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "text_1" }
            yield { type: "text-delta", id: "text_1", text: "partial answer" }
            readyResolve()
            await new Promise((_, reject) => {
              input.abort.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              )
            })
          })(),
        } as any
      }

      return {
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "start-step" }
          yield { type: "text-start", id: "text_2" }
          yield { type: "text-delta", id: "text_2", text: "recovered answer" }
          yield { type: "text-end", id: "text_2" }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
          }
          yield { type: "finish" }
        })(),
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Prompt Abort Flow Test" })

        const pending = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "start work" }],
        })

        await ready
        await SessionPrompt.cancel(session.id)

        const aborted = await pending
        expect(aborted.info.role).toBe("assistant")
        if (aborted.info.role === "assistant") {
          expect(aborted.info.error?.name).toBe("MessageAbortedError")
        }
        expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })

        const stored = await Session.messages({ sessionID: session.id })
        expect(stored).toHaveLength(2)
        expect(stored[1]?.parts.some((part) => part.type === "text" && part.text.includes("partial answer"))).toBe(true)

        const recovered = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "continue" }],
        })

        expect(recovered.info.role).toBe("assistant")
        expect(recovered.parts.some((part) => part.type === "text" && part.text.includes("recovered answer"))).toBe(true)

        const all = await Session.messages({ sessionID: session.id })
        expect(all).toHaveLength(4)
        expect(all[1]?.info.role).toBe("assistant")
        expect(all[3]?.parts.some((part) => part.type === "text" && part.text.includes("recovered answer"))).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("stops cleanly after a permission-rejected tool call and allows later recovery", async () => {
    await using tmp = await tmpdir({ git: true })

    modelSpy = spyOn(Provider, "getModel").mockResolvedValue(model)
    summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue()

    let call = 0
    streamSpy = spyOn(LLM, "stream").mockImplementation(async () => {
      call++
      if (call === 1) {
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "edit" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "edit", input: { file: "src/file.ts" } }
            yield {
              type: "tool-error",
              toolCallId: "call_1",
              input: { file: "src/file.ts" },
              error: new Permission.RejectedError(),
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            }
            yield { type: "finish" }
          })(),
        } as any
      }

      return {
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "start-step" }
          yield { type: "text-start", id: "text_3" }
          yield { type: "text-delta", id: "text_3", text: "continued after denial" }
          yield { type: "text-end", id: "text_3" }
          yield {
            type: "finish-step",
            finishReason: "stop",
            usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
          }
          yield { type: "finish" }
        })(),
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Prompt Permission Flow Test" })

        const denied = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "edit file" }],
        })

        expect(denied.info.role).toBe("assistant")
        expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })

        const stored = await Session.messages({ sessionID: session.id })
        expect(stored).toHaveLength(2)
        expect(stored[1]?.parts.some((part) => part.type === "tool" && part.state.status === "error")).toBe(true)
        expect(stored[1]?.parts.some((part) => part.type === "step-finish" && part.reason === "tool-calls")).toBe(true)

        const recovered = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "continue without edit" }],
        })

        expect(recovered.info.role).toBe("assistant")
        expect(recovered.parts.some((part) => part.type === "text" && part.text.includes("continued after denial"))).toBe(
          true,
        )

        const all = await Session.messages({ sessionID: session.id })
        expect(all).toHaveLength(4)

        await Session.remove(session.id)
      },
    })
  })
})
