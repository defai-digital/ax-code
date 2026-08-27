import { afterEach, describe, expect, test } from "vitest"
import { CustomApiProvider } from "../../src/provider/custom-api-provider"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("custom API provider identity", () => {
  test("slugs a hostname into a provider ID and display name", () => {
    expect(CustomApiProvider.identityFromBaseURL("https://llm.example.com/v1")).toEqual({
      name: "llm.example.com",
      providerID: "llm-example-com",
    })
    expect(CustomApiProvider.identityFromBaseURL("http://127.0.0.1:8080/v1")).toEqual({
      name: "127.0.0.1",
      providerID: "127-0-0-1",
    })
  })
})

describe("custom API provider model discovery", () => {
  test("parses OpenAI-compatible /models payloads", () => {
    expect(
      CustomApiProvider.parseDiscoveredModels({
        data: [{ id: "coding" }, { id: "coding" }, { id: "bad id" }, { id: "glm-5.3", name: "GLM 5.3" }],
      }),
    ).toEqual([
      expect.objectContaining({ id: "coding", name: "coding", contextWindow: 128_000, outputLimit: 16_384 }),
      expect.objectContaining({
        id: "glm-5.3",
        name: "GLM 5.3",
        contextWindow: 1_000_000,
        outputLimit: 16_384,
        reasoning: true,
      }),
    ])
  })

  test("prefers gateway-reported context_length over the capability registry", () => {
    expect(
      CustomApiProvider.parseDiscoveredModels({
        data: [{ id: "glm-5.3", context_length: 64_000, max_output_tokens: 8_192 }],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "glm-5.3",
        contextWindow: 64_000,
        outputLimit: 8_192,
      }),
    ])
  })

  test("maps catalog keys across reseller prefixes and [1m] suffixes", () => {
    expect(CustomApiProvider.catalogModelKey("zai/glm-5.3[1m]")).toBe(CustomApiProvider.catalogModelKey("glm-5.3"))
    expect(
      CustomApiProvider.catalogLimitForModelID("glm-5.3", {
        zai: { models: { "glm-5.3": { id: "glm-5.3", limit: { context: 1_000_000, output: 131_072 } } } },
        requesty: { models: { "glm-5.3": { id: "glm-5.3", limit: { context: 1_000_000, output: 128_000 } } } },
      }),
    ).toEqual({ context: 1_000_000, output: 131_072 })
  })

  test("replaces persisted discovery defaults but keeps explicit non-default limits", () => {
    expect(
      CustomApiProvider.inheritCustomApiModelLimit({
        modelID: "glm-5.3",
        limit: { context: 128_000, output: 16_384 },
        catalog: {
          zai: { models: { "glm-5.3": { id: "glm-5.3", limit: { context: 1_000_000, output: 131_072 } } } },
        },
        replaceDiscoveryDefaults: true,
      }),
    ).toEqual({ context: 1_000_000, output: 131_072 })

    expect(
      CustomApiProvider.inheritCustomApiModelLimit({
        modelID: "glm-5.3",
        limit: { context: 200_000, output: 32_000 },
        catalog: {
          zai: { models: { "glm-5.3": { id: "glm-5.3", limit: { context: 1_000_000, output: 131_072 } } } },
        },
        replaceDiscoveryDefaults: true,
      }),
    ).toEqual({ context: 200_000, output: 32_000 })

    expect(
      CustomApiProvider.inheritCustomApiModelLimit({
        modelID: "coding",
        limit: { context: 128_000, output: 16_384 },
        replaceDiscoveryDefaults: true,
      }),
    ).toEqual({ context: 128_000, output: 16_384 })

    expect(
      CustomApiProvider.inheritCustomApiModelLimit({
        modelID: "glm-5.3",
        limit: { context: 128_000, output: 16_384 },
        catalog: {
          "nano-gpt": { models: { "glm-5.3": { id: "glm-5.3", limit: { context: 1_048_576, output: 131_072 } } } },
        },
        replaceDiscoveryDefaults: true,
      }),
    ).toEqual({ context: 1_000_000, output: 131_072 })
  })

  test("loads models from GET /models with a bearer token", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      expect(String(input)).toBe("http://127.0.0.1:18080/v1/models")
      return new Response(JSON.stringify({ data: [{ id: "coding" }] }), { status: 200 })
    }) as typeof fetch

    await expect(
      CustomApiProvider.discoverModels({
        baseURL: "http://127.0.0.1:18080/v1",
        apiKey: "axt_test",
      }),
    ).resolves.toEqual([expect.objectContaining({ id: "coding" })])
  })
})
