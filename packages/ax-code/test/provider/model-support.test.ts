import { describe, expect, test } from "vitest"
import {
  buildModelProbes,
  isModelSupportedForProvider,
  probesHaveGlmMajorVersion,
  supportsAllowedGrokModel,
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

describe("supportsAllowedGrokModel", () => {
  // Grok is restricted to an explicit allow-list.
  // Anything else with "grok" in its probes is dropped, regardless of version.
  test.each([
    ["grok-4.5", true],
    ["grok-4-5", true],
    ["grok-4.5-latest", true],
    ["grok-build-latest", true],
  ])("accepts %s", (id, expected) => {
    expect(supportsAllowedGrokModel(probes(id))).toBe(expected)
  })

  test.each([
    ["grok-4.3", false],
    ["grok-4-3", false],
    ["grok-code-fast-1", false],
    ["grok-code-fast", false],
    ["grok-code-fast-1-0825", false],
    ["grok-build-0.1", false],
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
    expect(supportsAllowedGrokModel(probes(id))).toBe(expected)
  })

  test("passes non-grok probes through", () => {
    expect(supportsAllowedGrokModel(neutralProbes("claude-opus-4-7", "claude-opus"))).toBe(true)
    expect(supportsOpenAIGptModels(neutralProbes("gpt-5", "gpt"))).toBe(true)
    expect(supportsGlmModels(neutralProbes("glm-5", "glm"))).toBe(true)
  })

  test("supportsGrok41OrAllowedCodingModel is a deprecated alias", () => {
    expect(supportsGrok41OrAllowedCodingModel).toBe(supportsAllowedGrokModel)
  })
})

describe("probesHaveGlmMajorVersion", () => {
  test("matches the exact major version across separator spellings", () => {
    expect(probesHaveGlmMajorVersion(buildModelProbes("glm-5.2"), 5)).toBe(true)
    expect(probesHaveGlmMajorVersion(buildModelProbes("glm5.2"), 5)).toBe(true)
    expect(probesHaveGlmMajorVersion(buildModelProbes("glm-5.1[1m]"), 5)).toBe(true)
    expect(probesHaveGlmMajorVersion(buildModelProbes("glm-4.7-flash"), 5)).toBe(false)
    expect(probesHaveGlmMajorVersion(buildModelProbes("glm-4.7-flash"), 4)).toBe(true)
  })

  test("returns false for versionless glm aliases", () => {
    expect(probesHaveGlmMajorVersion(buildModelProbes("glm-zero-preview"), 5)).toBe(false)
    expect(probesHaveGlmMajorVersion(buildModelProbes("my-glm", { family: "glm" }), 5)).toBe(false)
  })
})

describe("isModelSupportedForProvider", () => {
  test("applies the global future GPT rejection before provider filters", () => {
    expect(isModelSupportedForProvider("custom", "gpt-5.5")).toBe(false)
    expect(isModelSupportedForProvider("custom", "openai/gpt-5.5-codex")).toBe(false)
  })

  test("hides embedding models for every provider", () => {
    expect(isModelSupportedForProvider("huggingface", "Qwen/Qwen3-Embedding-4B")).toBe(false)
    expect(isModelSupportedForProvider("huggingface", "Qwen/Qwen3-Embedding-8B")).toBe(false)
    expect(isModelSupportedForProvider("openai", "text-embedding-3-large")).toBe(false)
    expect(isModelSupportedForProvider("custom", "embed-english-v3")).toBe(false)
    expect(isModelSupportedForProvider("huggingface", "Qwen/Qwen3.6-27B")).toBe(true)
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
    expect(isModelSupportedForProvider("xai", "grok-4.3")).toBe(false)
    expect(isModelSupportedForProvider("xai", "grok-build-0.1")).toBe(false)
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

  test("GLM real-catalog text SKUs are offered", () => {
    // Every GLM SKU currently in models-snapshot.json that should reach the picker.
    for (const id of [
      "glm-5",
      "glm-5-2",
      "glm-5.2",
      "glm-5.2[1m]",
      "glm5.2",
      "glm-5.2-fast",
      "glm-5.2-nitro",
      "glm-5.2-flex",
      "glm-5.2-fp4",
      "glm-5.2-caveman",
      "glm-5.2-honey",
      "glm-5.2-ponytail",
      "glm-5.2-short",
      "glm-5-free",
      "glm-5.2:free",
      "glm-5.2@eu",
      "glm5.2-fast",
    ]) {
      expect(isModelSupportedForProvider("zai", id)).toBe(true)
    }
  })

  test("GLM vision SKUs are hidden across versions and separators", () => {
    for (const id of ["glm-5v", "glm5v", "glm-6v", "glm6v"]) {
      expect(isModelSupportedForProvider("zai", id)).toBe(false)
    }
    // A version like 5.10 must NOT be misread as vision by the /glm\d+v/ guard.
    expect(isModelSupportedForProvider("zai", "glm-5.10")).toBe(true)
  })

  test("legacy / unversioned GLM SKUs are hidden", () => {
    for (const id of ["glm-z1-air", "glm-z1-airx", "glm-zero-preview", "glm-for-coding"]) {
      expect(isModelSupportedForProvider("zhipuai", id)).toBe(false)
    }
  })

  test("passes unknown providers through unless a global rejection matches", () => {
    expect(isModelSupportedForProvider("custom", "custom-model")).toBe(true)
  })
})

describe("xai Live Search gates for Grok 4.5", () => {
  test("grok-4.5 supports server-side Live Search", () => {
    expect(supportsLiveSearch("grok-4.5")).toBe(true)
    expect(supportsLiveSearch("grok-4.5-latest")).toBe(true)
  })

  test("multi-agent grok-4 variants still opt out of Live Search", () => {
    expect(supportsLiveSearch("grok-4.20-multi-agent-0309")).toBe(false)
  })

  test("retired coding SKUs do not auto-enable Live Search", () => {
    expect(supportsLiveSearch("grok-build-0.1")).toBe(false)
  })
})
