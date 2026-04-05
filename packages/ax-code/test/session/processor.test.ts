import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRetry } from "../../src/session/retry"
import { MessageID } from "../../src/session/schema"
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
let sleepSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  sleepSpy?.mockRestore()
  sleepSpy = undefined
})

describe("session.processor", () => {
  test("marks tool-using steps as tool-calls even when provider finish reason is stop", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
          mode: "build",
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: session.id,
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
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        streamSpy = spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-input-start", id: "call_1", toolName: "glob" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "glob", input: { pattern: "**/*" } }
            yield {
              type: "tool-result",
              toolCallId: "call_1",
              input: { pattern: "**/*" },
              output: { output: "match", title: "Glob", metadata: {}, attachments: [] },
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "finish" }
          })(),
        } as any)

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(result).toBe("continue")
        expect(processor.message.finish).toBe("tool-calls")
      },
    })
  })

  test("resets tool tracking for a later non-tool step in the same stream", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
          mode: "build",
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: session.id,
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
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        streamSpy = spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "tool-call", toolCallId: "call_1", toolName: "glob", input: { pattern: "**/*" } }
            yield {
              type: "tool-result",
              toolCallId: "call_1",
              input: { pattern: "**/*" },
              output: { output: "match", title: "Glob", metadata: {}, attachments: [] },
            }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
            }
            yield { type: "start-step" }
            yield { type: "text-start", id: "text_1" }
            yield { type: "text-delta", id: "text_1", text: "done" }
            yield { type: "text-end", id: "text_1" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 110, outputTokens: 15, totalTokens: 125 },
            }
            yield { type: "finish" }
          })(),
        } as any)

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(result).toBe("continue")
        expect(processor.message.finish).toBe("stop")
      },
    })
  })

  test("stops after capped retryable failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
          mode: "build",
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: session.id,
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
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const err = new MessageV2.APIError({
          message: "Rate Limited",
          isRetryable: true,
        }).toObject()

        streamSpy = spyOn(LLM, "stream").mockImplementation(async () => {
          throw err
        })
        sleepSpy = spyOn(SessionRetry, "sleep").mockResolvedValue()

        const processor = SessionProcessor.create({
          assistantMessage: assistant as MessageV2.Assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const result = await processor.process({
          user: user as MessageV2.User,
          agent: await Agent.get("build"),
          abort: AbortSignal.any([]),
          sessionID: session.id,
          system: [],
          messages: [],
          tools: {},
          model,
        })

        expect(result).toBe("stop")
        expect(streamSpy.mock.calls.length).toBe(SessionRetry.RETRY_MAX_ATTEMPTS + 1)
        expect(sleepSpy.mock.calls.length).toBe(SessionRetry.RETRY_MAX_ATTEMPTS)
        expect(processor.message.error).toBeDefined()
      },
    })
  })

  test("publishes one error event after retry exhaustion", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
          mode: "build",
        } as MessageV2.User)
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          sessionID: session.id,
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
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
        } as MessageV2.Assistant)

        const err = new MessageV2.APIError({
          message: "Rate Limited",
          isRetryable: true,
        }).toObject()

        const events: string[] = []
        const unsub = Bus.subscribe(Session.Event.Error, () => {
          events.push("error")
        })

        streamSpy = spyOn(LLM, "stream").mockImplementation(async () => {
          throw err
        })
        sleepSpy = spyOn(SessionRetry, "sleep").mockResolvedValue()

        try {
          const processor = SessionProcessor.create({
            assistantMessage: assistant as MessageV2.Assistant,
            sessionID: session.id,
            model,
            abort: AbortSignal.any([]),
          })

          const result = await processor.process({
            user: user as MessageV2.User,
            agent: await Agent.get("build"),
            abort: AbortSignal.any([]),
            sessionID: session.id,
            system: [],
            messages: [],
            tools: {},
            model,
          })

          expect(result).toBe("stop")
          expect(events).toHaveLength(1)
        } finally {
          unsub()
        }
      },
    })
  })
})
