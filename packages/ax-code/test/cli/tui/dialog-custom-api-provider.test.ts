import { describe, expect, test } from "vitest"
import { CustomApiProvider } from "../../../src/provider/custom-api-provider"
import {
  isManagedCustomApiProviderConfig,
  parseCustomApiProviderModelIDs,
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
