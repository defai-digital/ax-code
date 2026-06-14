import { afterEach, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { executePromptCommand } from "../../src/session/prompt-command-execution"
import type { PromptInput } from "../../src/session/prompt-input"
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

let modelSpy: ReturnType<typeof spyOn> | undefined

afterEach(async () => {
  modelSpy?.mockRestore()
  modelSpy = undefined
  await Instance.disposeAll()
})

test("preserves explicit skill command agent during prompt execution", async () => {
  await using tmp = await tmpdir({ git: true })
  modelSpy = spyOn(Provider, "getModel").mockResolvedValue(model)
  const calls: PromptInput[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      await executePromptCommand(
        {
          sessionID: session.id,
          command: "debug-n-fix",
          arguments: "broken command",
          agent: "architect",
          model: "test/test-model",
        },
        async (input) => {
          calls.push(input)
          return {
            info: {
              id: "msg_command_test" as any,
              sessionID: session.id,
              role: "assistant",
              time: { created: Date.now() },
              agent: input.agent ?? "debug",
              model: input.model,
            },
            parts: [],
          } as any
        },
      )
    },
  })

  expect(calls).toHaveLength(1)
  expect(calls[0].agent).toBe("debug")
  expect(calls[0].agentRouting).toBe("preserve")
})
