import { describe, expect, test } from "vitest"
import {
  buildModelProbes,
  isModelSupportedForProvider,
  supportsGlmModels,
  supportsGrok41OrAllowedCodingModel,
  supportsOpenAIGptModels,
} from "../../src/provider/model-support"
import { supportsLiveSearch } from "../../src/provider/xai/server-tools"

function probes(modelID: string) {
  return buildModelProbes(modelID, { id: modelID, name: modelID, family: "grok" })
}

function neutralProbes(modelID: string, family: string) {
  return buildModelProbes(modelID, { id: modelID, name: modelID, family })
}

describe("supportsGrok41OrAllowedCodingModel", () => {
  // Grok is restricted to an explicit allow-list.
  // Anything else with "grok" in its probes is dropped, regardless of version.
  test.each([
    ["grok-4.5", true],
    ["grok-4-5", true],
    ["grok-4.5-latest", true],
    ["grok-build-latest", true],
    ["grok-4.3", true],
    ["grok-4-3", true],
    ["grok-code-fast-1", true],
    ["grok-code-fast", true],
    ["grok-code-fast-1-0825", true],
    ["grok-build-0.1", true],
  ])("accepts %s", (id, expected) => {
    expect(supportsGrok41OrAllowedCodingModel(probes(id))).toBe(expected)
  })

  test.each([
    ["grok-4.2", false],
    ["grok-4.1", false],
    ["grok-4-1", false],
    ["grok-4-1-fast", false],
    ["grok-4", false],
    ["grok-4-fast", false],
    ["grok-4-0709", false],
    ["grok-5", false],
    ["grok-5.1", false],
    ["grok-3", false],
    ["grok-beta", false],
    ["grok-vision-beta", false],
  ])("rejects %s", (id, expected) => {
    expect(supportsGrok41OrAllowedCodingModel(probes(id))).toBe(expected)
  })

  test("passes non-grok probes through", () => {
    expect(supportsGrok41OrAllowedCodingModel(neutralProbes("claude-opus-4-7", "claude-opus"))).toBe(true)
    expect(supportsOpenAIGptModels(neutralProbes("gpt-5", "gpt"))).toBe(true)
    expect(supportsGlmModels(neutralProbes("glm-5", "glm"))).toBe(true)
  })
})

describe("isModelSupportedForProvider", () => {
  test("applies the global future GPT rejection before provider filters", () => {
    expect(isModelSupportedForProvider("custom", "gpt-5.5")).toBe(false)
    expect(isModelSupportedForProvider("custom", "openai/gpt-5.5-codex")).toBe(false)
  })

  test("keeps Gemini filtering scoped to Google providers", () => {
    expect(isModelSupportedForProvider("google", "gemini-3-pro")).toBe(true)
    expect(isModelSupportedForProvider("google-vertex", "Gemini 2.5 Pro")).toBe(false)
    expect(isModelSupportedForProvider("google", "imagen-4")).toBe(true)
  })

  test("matches Gemini 3 regardless of separator style", () => {
    expect(isModelSupportedForProvider("google", "gemini_3_pro")).toBe(true)
    expect(isModelSupportedForProvider("google", "gemini 3 pro")).toBe(true)
    expect(isModelSupportedForProvider("google-vertex", "gemini_2.5_pro")).toBe(false)
    expect(isModelSupportedForProvider("google", "models/preview-latest", { name: "Gemini 3 Pro Preview" })).toBe(true)
    expect(isModelSupportedForProvider("google", "models/preview-latest", { name: "Gemini 2.5 Pro" })).toBe(false)
  })

  test("applies OpenAI, xAI, and GLM provider filters from model probes", () => {
    expect(isModelSupportedForProvider("openai", "gpt-4.1")).toBe(true)
    expect(isModelSupportedForProvider("openai", "gpt-3.5")).toBe(false)
    expect(isModelSupportedForProvider("xai", "grok-4.5")).toBe(true)
    expect(isModelSupportedForProvider("xai", "grok-4.3")).toBe(true)
    expect(isModelSupportedForProvider("xai", "grok-build-0.1")).toBe(true)
    expect(isModelSupportedForProvider("xai", "grok-4.2")).toBe(false)
    expect(isModelSupportedForProvider("zai", "glm-5.2")).toBe(true)
    expect(isModelSupportedForProvider("zai", "glm-5")).toBe(true)
    expect(isModelSupportedForProvider("zai", "glm-5.1")).toBe(false)
    expect(isModelSupportedForProvider("zai", "glm-5.1[1m]")).toBe(false)
    expect(isModelSupportedForProvider("zai", "zai-org/glm-5.1-tee")).toBe(false)
    expect(isModelSupportedForProvider("zai", "zai-org/glm-5.1:thinking")).toBe(false)
    expect(isModelSupportedForProvider("zai", "coding-glm-5.1-free")).toBe(false)
    expect(isModelSupportedForProvider("zai", "zai-glm-5-1")).toBe(false)
    expect(isModelSupportedForProvider("zai", "glm-5-turbo")).toBe(false)
    expect(isModelSupportedForProvider("zai", "glm-5.10")).toBe(true)
    expect(isModelSupportedForProvider("zhipuai", "glm-4.5")).toBe(false)
  })

  test("passes unknown providers through unless a global rejection matches", () => {
    expect(isModelSupportedForProvider("custom", "custom-model")).toBe(true)
  })
})

describe("xai Live Search gates for Grok 4.x", () => {
  test("grok-4.5 and grok-4.3 support server-side Live Search", () => {
    expect(supportsLiveSearch("grok-4.5")).toBe(true)
    expect(supportsLiveSearch("grok-4.5-latest")).toBe(true)
    expect(supportsLiveSearch("grok-4.3")).toBe(true)
    expect(supportsLiveSearch("grok-4-3")).toBe(true)
  })

  test("multi-agent grok-4 variants still opt out of Live Search", () => {
    expect(supportsLiveSearch("grok-4.20-multi-agent-0309")).toBe(false)
  })

  test("grok-build does not auto-enable Live Search", () => {
    expect(supportsLiveSearch("grok-build-0.1")).toBe(false)
  })
})
