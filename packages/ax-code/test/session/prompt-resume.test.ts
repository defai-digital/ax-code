import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
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

afterEach(() => {
  streamSpy?.mockRestore()
  streamSpy = undefined
  modelSpy?.mockRestore()
  modelSpy = undefined
})

describe("session.prompt resume_existing", () => {
  test("starts a new loop when resume_existing is requested without active state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
          mode: "build",
        } as MessageV2.User)

        modelSpy = spyOn(Provider, "getModel").mockResolvedValue(model)
        streamSpy = spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "start-step" }
            yield { type: "text-start", id: "text_1" }
            yield { type: "text-delta", id: "text_1", text: "resumed safely" }
            yield { type: "text-end", id: "text_1" }
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            }
            yield { type: "finish" }
          })(),
        } as any)

        const msg = await SessionPrompt.loop({ sessionID: session.id, resume_existing: true })

        expect(msg.info.role).toBe("assistant")
        expect(msg.parts.some((part) => part.type === "text" && part.text.includes("resumed safely"))).toBe(true)
        expect(await SessionStatus.get(session.id)).toEqual({ type: "idle" })

        await Session.remove(session.id)
      },
    })
  })
})
