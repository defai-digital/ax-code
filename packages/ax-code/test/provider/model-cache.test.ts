import { afterEach, expect, test, vi } from "vitest"
import { generateText } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

vi.mock("@ai-sdk/openai-compatible", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ai-sdk/openai-compatible")>()
  return { ...original, createOpenAICompatible: vi.fn(original.createOpenAICompatible) }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test("evicts SDK configurations alongside bounded language models", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  const providerID = ProviderID.make("bounded-cache-provider")
  await using tmp = await tmpdir({
    config: {
      provider: {
        [providerID]: {
          name: "Bounded Cache Provider",
          npm: "@ai-sdk/openai-compatible",
          api: "https://cache.example/v1",
          env: [],
          options: { apiKey: "test-key" },
          models: { "test-model": { name: "Test Model", limit: { context: 8192, output: 1024 } } },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const base = await Provider.getModel(providerID, ModelID.make("test-model"))
      const model = (route: number): typeof base => ({ ...base, headers: { "x-route": String(route) } })
      const cacheCapacity = 512
      const factory = vi.mocked(createOpenAICompatible)
      const initial = factory.mock.calls.length
      for (let route = 0; route <= cacheCapacity; route++) await Provider.getLanguage(model(route))
      expect(factory.mock.calls.length - initial).toBe(cacheCapacity + 1)
      // A retained model uses its existing SDK, even if its language entry is rebuilt.
      await Provider.getLanguage(model(cacheCapacity))
      expect(factory.mock.calls.length - initial).toBe(cacheCapacity + 1)
      await Provider.getLanguage(model(0))
      expect(factory.mock.calls.length - initial).toBe(cacheCapacity + 2)
    },
  })
})

test.each(["url", "x-model-route", "x-api-key"])("model cache follows changes to %s", async (field) => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  const requests: Array<{ url: string; route: string | null }> = []
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      route: new Headers(init?.headers).get(field),
    })
    return Response.json({
      id: "completion-test",
      model: "test-model",
      created: 1,
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })
  const providerID = ProviderID.make("cache-provider")
  await using tmp = await tmpdir({
    config: {
      provider: {
        [providerID]: {
          name: "Cache Provider",
          npm: "@ai-sdk/openai-compatible",
          api: "https://first.example/v1",
          env: [],
          options: { apiKey: "test-key" },
          models: {
            "test-model": { name: "Test Model", tool_call: true, limit: { context: 8192, output: 1024 } },
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const base = await Provider.getModel(providerID, ModelID.make("test-model"))
      for (const value of ["first", "second"]) {
        const model = {
          ...base,
          api: { ...base.api, url: field === "url" ? `https://${value}.example/v1` : base.api.url },
          headers: field === "url" ? {} : { [field]: value },
        }
        const language = await Provider.getLanguage(model)
        const result = await generateText({ model: language, prompt: "Hello", maxRetries: 0 })
        expect(result.text).toBe("OK")
      }
      expect(requests).toEqual(
        ["first", "second"].map((value) => ({
          url: `https://${field === "url" ? value : "first"}.example/v1/chat/completions`,
          route: field === "url" ? null : value,
        })),
      )
    },
  })
})
