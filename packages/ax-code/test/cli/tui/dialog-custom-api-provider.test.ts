import { describe, expect, test } from "vitest"
import { CustomApiProvider } from "../../../src/provider/custom-api-provider"
import {
  customApiConnectKeepsSavedToken,
  findCustomApiProviderByBaseURL,
  isManagedCustomApiProviderConfig,
  parseCustomApiProviderModelIDs,
  sameCustomApiBaseURL,
} from "../../../src/cli/cmd/tui/component/dialog-custom-api-provider"

describe("custom API provider TUI helpers", () => {
  test("parses comma- and newline-separated model IDs with safe defaults", () => {
    expect(parseCustomApiProviderModelIDs("model-a, model-b\nmodel-c")).toEqual([
      expect.objectContaining({ id: "model-a", contextWindow: 128_000, outputLimit: 16_384, toolCall: true }),
      expect.objectContaining({ id: "model-b", contextWindow: 128_000, outputLimit: 16_384, toolCall: true }),
      expect.objectContaining({ id: "model-c", contextWindow: 128_000, outputLimit: 16_384, toolCall: true }),
    ])
    expect(parseCustomApiProviderModelIDs("glm-5.3")).toEqual([
      expect.objectContaining({ id: "glm-5.3", contextWindow: 1_000_000, reasoning: true }),
    ])
  })

  test("preserves model metadata when updating existing IDs", () => {
    const existing = {
      id: "model-a",
      name: "Model A",
      contextWindow: 200_000,
      outputLimit: 32_000,
      toolCall: true,
      reasoning: true,
      attachment: true,
      temperature: false,
    }
    expect(parseCustomApiProviderModelIDs("model-a", [existing])).toEqual([existing])
  })

  test("rejects missing, duplicate, whitespace, and excessive model IDs", () => {
    expect(() => parseCustomApiProviderModelIDs(" ")).toThrow("At least one model")
    expect(() => parseCustomApiProviderModelIDs("model-a, model-a")).toThrow("Duplicate model ID")
    expect(() => parseCustomApiProviderModelIDs("model a")).toThrow("Invalid model ID")
    expect(() =>
      parseCustomApiProviderModelIDs(Array.from({ length: 129 }, (_, index) => `m${index}`).join(",")),
    ).toThrow("at most 128 models")
  })

  test("connect dialog identity comes from the base URL", () => {
    expect(CustomApiProvider.identityFromBaseURL("https://trust.example/v1").providerID).toBe("trust-example")
  })

  test("recognizes only editor-managed custom providers", () => {
    expect(
      isManagedCustomApiProviderConfig(
        { provider: { gateway: { management: "custom-api" }, manual: { npm: "@ai-sdk/openai-compatible" } } },
        "gateway",
      ),
    ).toBe(true)
    expect(
      isManagedCustomApiProviderConfig(
        { provider: { gateway: { management: "custom-api" }, manual: { npm: "@ai-sdk/openai-compatible" } } },
        "manual",
      ),
    ).toBe(false)
  })
})

describe("sameCustomApiBaseURL", () => {
  test("ignores trailing slashes and host casing but not paths or ports", () => {
    expect(sameCustomApiBaseURL("http://127.0.0.1:38080/v1", "http://127.0.0.1:38080/v1/")).toBe(true)
    expect(sameCustomApiBaseURL("https://API.Example.com/v1", "https://api.example.com/v1")).toBe(true)
    expect(sameCustomApiBaseURL("http://127.0.0.1:38080/v1", "http://127.0.0.1:38081/v1")).toBe(false)
    expect(sameCustomApiBaseURL("https://api.example.com/v1", "https://api.example.com/v2")).toBe(false)
  })
})

describe("custom API connect token reuse", () => {
  const registered = {
    providerID: "127.0.0.1",
    name: "127.0.0.1",
    protocol: "openai-compatible" as const,
    baseURL: "http://127.0.0.1:38080/v1",
    hasApiKey: true,
    models: [],
  }

  test("finds the managed provider that already serves the typed URL", () => {
    expect(findCustomApiProviderByBaseURL([registered], "http://127.0.0.1:38080/v1/")).toBe(registered)
    expect(findCustomApiProviderByBaseURL([registered], "")).toBeUndefined()
  })

  test("allows a blank token when add-mode reconnects an endpoint that already has a key", () => {
    expect(
      customApiConnectKeepsSavedToken({
        baseURL: "http://127.0.0.1:38080/v1/",
        registered: [registered],
      }),
    ).toBe(true)
    expect(
      customApiConnectKeepsSavedToken({
        baseURL: "http://127.0.0.1:38080/v1",
        existing: { hasApiKey: true },
      }),
    ).toBe(true)
  })

  test("still requires a token for a new URL or a registered endpoint without a key", () => {
    expect(customApiConnectKeepsSavedToken({ baseURL: "https://api.example.com/v1" })).toBe(false)
    expect(
      customApiConnectKeepsSavedToken({
        baseURL: "http://127.0.0.1:38080/v1",
        registered: [{ ...registered, hasApiKey: false }],
      }),
    ).toBe(false)
  })
})
