import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { resolveUserMessageRouting } from "../../src/session/prompt/prompt-routing"
import { createUserMessage } from "../../src/session/prompt/prompt-user-message"
import { MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const providers = {
  "remote-gw": {
    npm: "@ai-sdk/openai-compatible",
    options: { apiKey: "test-key", baseURL: "https://api.example.com/v1" },
    models: {
      big: { name: "big", tool_call: true, limit: { context: 128_000, output: 8_192 } },
      small: { name: "small", tool_call: true, limit: { context: 128_000, output: 4_096 } },
    },
  },
}

async function withRoutingConfig(fn: () => Promise<void>) {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  await using tmp = await tmpdir({
    config: {
      model: "remote-gw/big",
      // Configured but unavailable: the provider/model does not exist.
      small_model: "missing/model",
      routing: { llm: true },
      provider: providers,
    },
  })
  await Instance.provide({ directory: tmp.path, fn })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("resolveUserMessageRouting complexity route", () => {
  test("a short message with an unavailable small_model skips routing without throwing", async () => {
    await withRoutingConfig(async () => {
      const session = await Session.create({})
      const result = await resolveUserMessageRouting({
        sessionID: session.id,
        messageID: MessageID.ascending(),
        agentName: "build",
        messageText: "continue",
        parts: [{ type: "text" }],
      })
      expect(result.complexityModel).toBeUndefined()
    })
  })

  test("the turn stays on the session model instead of failing", async () => {
    await withRoutingConfig(async () => {
      const session = await Session.create({})
      const message = await createUserMessage({
        sessionID: session.id,
        agent: "build",
        parts: [{ type: "text", text: "continue" }],
      })
      expect(message.info.model).toEqual({ providerID: "remote-gw", modelID: "big" })
      expect(message.info.modelOrigin).toBe("session-or-config")
    })
  })
})
