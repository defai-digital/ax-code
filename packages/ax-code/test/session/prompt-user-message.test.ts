import { afterEach, describe, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { createAutonomousTextContinuation, createUserMessage } from "../../src/session/prompt-user-message"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.unstubAllEnvs())

describe("prompt user message helpers", () => {
  test("autonomous text continuations preserve the previous user agent and model", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const first = await createUserMessage({
          sessionID: session.id,
          agent: "build",
          model: {
            providerID: "openai" as any,
            modelID: "gpt-5.2" as any,
          },
          parts: [{ type: "text", text: "start" }],
        })

        await createAutonomousTextContinuation({
          sessionID: session.id,
          messages: [first],
          text: "continue",
        })

        const messages = await Session.messages({ sessionID: session.id })
        const users = messages.filter((message) => message.info.role === "user")
        expect(users).toHaveLength(2)
        expect(users[1]!.info).toMatchObject({
          agent: "build",
          model: {
            providerID: "openai",
            modelID: "gpt-5.2",
          },
        })
        expect(users[1]!.parts).toEqual([expect.objectContaining({ type: "text", text: "continue" })])
      },
    })
  })
})

describe("prompt user message agent model fallback", () => {
  test("an agent pinned to a disabled provider falls back instead of failing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        disabled_providers: ["deepseek"],
        agent: {
          build: {
            model: "deepseek/deepseek-v4-pro",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = await createUserMessage({
          sessionID: session.id,
          agent: "build",
          parts: [{ type: "text", text: "start" }],
        })
        expect(message.info.agent).toBe("build")
        expect(message.info.model.providerID).not.toBe("deepseek")
        expect(message.info.model.modelID).toBeTruthy()
      },
    })
  })
})

describe("prompt user message requested model", () => {
  const config = {
    disabled_providers: ["deepseek"],
    provider: {
      "127.0.0.1": {
        management: "custom-api" as const,
        name: "127.0.0.1",
        npm: "@ai-sdk/openai-compatible",
        api: "http://127.0.0.1:8080/v1",
        env: [],
        models: {
          "glm-5.3": {
            id: "glm-5.3",
            name: "GLM 5.3",
            tool_call: true,
            limit: { context: 128_000, output: 16_384 },
          },
          "deepseek-v4-pro": {
            id: "deepseek-v4-pro",
            name: "DeepSeek V4 Pro",
            tool_call: true,
            limit: { context: 128_000, output: 16_384 },
          },
        },
        options: { baseURL: "http://127.0.0.1:8080/v1" },
      },
    },
  }

  test("a model requested on a disabled provider runs on the connected provider serving the same SKU", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({ git: true, config })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = await createUserMessage({
          sessionID: session.id,
          agent: "build",
          model: {
            providerID: ProviderID.make("deepseek"),
            modelID: ModelID.make("deepseek-v4-pro"),
          },
          parts: [{ type: "text", text: "start" }],
        })
        expect(message.info.agent).toBe("build")
        expect(message.info.model).toEqual({ providerID: "127.0.0.1", modelID: "deepseek-v4-pro" })
      },
    })
  })

  test("a requested model nobody serves is kept so dispatch fails loudly", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({ git: true, config })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = await createUserMessage({
          sessionID: session.id,
          agent: "build",
          model: { providerID: ProviderID.make("deepseek"), modelID: ModelID.make("deepseek-v9") },
          parts: [{ type: "text", text: "start" }],
        })
        expect(message.info.model).toEqual({ providerID: "deepseek", modelID: "deepseek-v9" })
      },
    })
  })
})

describe("prompt user message auto-route model precedence", () => {
  test("an explicit model survives auto-routing to an agent with a different pin", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({
      git: true,
      config: {
        disabled_providers: ["deepseek"],
        provider: {
          "127.0.0.1": {
            management: "custom-api",
            name: "127.0.0.1",
            npm: "@ai-sdk/openai-compatible",
            api: "http://127.0.0.1:8080/v1",
            env: [],
            models: {
              "glm-5.3": {
                id: "glm-5.3",
                name: "GLM 5.3",
                tool_call: true,
                limit: { context: 128_000, output: 16_384 },
              },
              "deepseek-v4-pro": {
                id: "deepseek-v4-pro",
                name: "DeepSeek V4 Pro",
                tool_call: true,
                limit: { context: 128_000, output: 16_384 },
              },
            },
            options: { baseURL: "http://127.0.0.1:8080/v1" },
          },
        },
        agent: {
          debug: {
            model: "deepseek/deepseek-v4-pro",
            variant: "high",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const message = await createUserMessage({
          sessionID: session.id,
          agent: "build",
          model: { providerID: ProviderID.make("127.0.0.1"), modelID: ModelID.make("glm-5.3") },
          parts: [{ type: "text", text: "debug this crash and find the bug" }],
        })
        expect(message.info.agent).toBe("debug")
        expect(message.info.model).toEqual({ providerID: "127.0.0.1", modelID: "glm-5.3" })
        expect(message.info.variant).toBeUndefined()

        const fallbackSession = await Session.create({})
        const fallback = await createUserMessage({
          sessionID: fallbackSession.id,
          agent: "build",
          parts: [{ type: "text", text: "debug this crash and find the bug" }],
        })
        expect(fallback.info.agent).toBe("debug")
        expect(fallback.info.model).toEqual({ providerID: "127.0.0.1", modelID: "deepseek-v4-pro" })
        expect(fallback.info.variant).toBe("high")
      },
    })
  })
})
