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

  test("prefers nested limit.context from the AX Code OpenAI-compatible row shape", () => {
    expect(
      CustomApiProvider.parseDiscoveredModels({
        data: [{ id: "coding", limit: { context: 204_800, output: 8_192 } }],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "coding",
        contextWindow: 204_800,
        outputLimit: 8_192,
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

  test("uses Trust-reported windows on public aliases that are not catalog SKUs", () => {
    expect(
      CustomApiProvider.parseDiscoveredModels({
        object: "list",
        data: [
          {
            id: "coding",
            object: "model",
            owned_by: "ax-trust",
            name: "coding",
            context_length: 1_000_000,
            max_output_tokens: 131_072,
            limit: { context: 1_000_000, output: 131_072 },
            capabilities: { reasoning: true, toolcall: true, temperature: true, attachment: false },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "coding",
        name: "coding",
        contextWindow: 1_000_000,
        outputLimit: 131_072,
        reasoning: true,
        toolCall: true,
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

describe("custom API provider catalog limits", () => {
  test("uses the median across reseller cards so one mistyped card cannot win", () => {
    expect(
      CustomApiProvider.catalogLimitForModelID("MiniMax-M2.7", {
        minimax: {
          models: { "MiniMax-M2.7": { id: "MiniMax-M2.7", limit: { context: 204_800, output: 131_072 } } },
        },
        nvidia: {
          models: {
            "minimaxai/minimax-m2.7": { id: "minimaxai/minimax-m2.7", limit: { context: 204_800, output: 131_072 } },
          },
        },
        hyper: { models: { "minimax-m2.7": { id: "minimax-m2.7", limit: { context: 262_100, output: 6_553 } } } },
        cortecs: { models: { "minimax-m2.7": { id: "minimax-m2.7", limit: { context: 196_608, output: 196_072 } } } },
      }),
    ).toEqual({ context: 204_800, output: 131_072 })
  })

  test("does not inherit an output equal to the context from a single outlier card", () => {
    expect(
      CustomApiProvider.inheritCustomApiModelLimit({
        modelID: "MiniMax-M2.7",
        limit: { context: 128_000, output: 16_384 },
        catalog: {
          minimax: {
            models: { "MiniMax-M2.7": { id: "MiniMax-M2.7", limit: { context: 204_800, output: 131_072 } } },
          },
          hyper: { models: { "minimax-m2.7": { id: "minimax-m2.7", limit: { context: 262_100, output: 6_553 } } } },
          cortecs: {
            models: { "minimax-m2.7": { id: "minimax-m2.7", limit: { context: 196_608, output: 196_072 } } },
          },
        },
        replaceDiscoveryDefaults: true,
      }),
    ).toEqual({ context: 204_800, output: 131_072 })
  })
})

describe("custom API provider discovery filtering", () => {
  test("skips embedding, rerank, and speech rows from GET /models", () => {
    expect(
      CustomApiProvider.parseDiscoveredModels({
        data: [
          { id: "text-embedding-3-small" },
          { id: "bge-reranker-v2-m3" },
          { id: "whisper-1" },
          { id: "tts-1" },
          { id: "deepseek-v4-flash" },
        ],
      }).map((model) => model.id),
    ).toEqual(["deepseek-v4-flash"])
  })

  test("reports connection failures as provider errors", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch

    await expect(
      CustomApiProvider.discoverModels({
        baseURL: "http://127.0.0.1:18080/v1",
        apiKey: "axt_test",
      }),
    ).rejects.toMatchObject({
      name: "CustomApiProviderError",
      data: { message: "GET http://127.0.0.1:18080/v1/models failed: fetch failed" },
    })
  })
})
