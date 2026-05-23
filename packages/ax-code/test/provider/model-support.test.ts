import { describe, expect, test } from "bun:test"
import {
  OPENROUTER_SUPPORTED_MODEL_IDS,
  buildModelProbes,
  isModelSupportedForProvider,
  supportsGlmModels,
  supportsGrok41OrAllowedCodingModel,
  supportsOpenAIGptModels,
  supportsOpenRouterModelID,
} from "../../src/provider/model-support"
import { supportsReasoning, supportsServerTools } from "../../src/provider/xai/server-tools"

function probes(modelID: string) {
  return buildModelProbes(modelID, { id: modelID, name: modelID, family: "grok" })
}

function neutralProbes(modelID: string, family: string) {
  return buildModelProbes(modelID, { id: modelID, name: modelID, family })
}

describe("supportsGrok41OrAllowedCodingModel", () => {
  // Grok is restricted to an explicit allow-list (grok-4.3 + grok-code-fast-1).
  // Anything else with "grok" in its probes is dropped, regardless of version.
  test.each([
    ["grok-4.3", true],
    ["grok-4-3", true],
    ["grok-code-fast-1", true],
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

describe("supportsOpenRouterModelID", () => {
  test("accepts the curated OpenRouter coding allow-list", () => {
    for (const id of OPENROUTER_SUPPORTED_MODEL_IDS) {
      expect(supportsOpenRouterModelID(id)).toBe(true)
    }
  })

  test.each(["openrouter/free", "openrouter/bodybuilder", "openai/gpt-5.2", "anthropic/claude-3-haiku"])(
    "rejects %s",
    (id) => {
      expect(supportsOpenRouterModelID(id)).toBe(false)
    },
  )
})

describe("isModelSupportedForProvider", () => {
  test("applies the global future GPT rejection before provider filters", () => {
    expect(isModelSupportedForProvider("custom", "gpt-5.5")).toBe(false)
    expect(isModelSupportedForProvider("openrouter", "openai/gpt-5.5-codex")).toBe(false)
  })

  test("uses the curated OpenRouter allow-list against the raw model id", () => {
    expect(isModelSupportedForProvider("openrouter", "openai/gpt-5.1-codex")).toBe(true)
    expect(isModelSupportedForProvider("openrouter", "gpt-5.1-codex")).toBe(false)
  })

  test("keeps Gemini filtering scoped to Google providers", () => {
    expect(isModelSupportedForProvider("google", "gemini-3-pro")).toBe(true)
    expect(isModelSupportedForProvider("google-vertex", "Gemini 2.5 Pro")).toBe(false)
    expect(isModelSupportedForProvider("google", "imagen-4")).toBe(true)
  })

  test("applies OpenAI, xAI, and GLM provider filters from model probes", () => {
    expect(isModelSupportedForProvider("openai", "gpt-4.1")).toBe(true)
    expect(isModelSupportedForProvider("openai", "gpt-3.5")).toBe(false)
    expect(isModelSupportedForProvider("xai", "grok-4.3")).toBe(true)
    expect(isModelSupportedForProvider("xai", "grok-4.2")).toBe(false)
    expect(isModelSupportedForProvider("zai", "glm-5.1")).toBe(true)
    expect(isModelSupportedForProvider("zhipuai", "glm-4.5")).toBe(false)
  })

  test("passes unknown providers through unless a global rejection matches", () => {
    expect(isModelSupportedForProvider("custom", "custom-model")).toBe(true)
  })
})

describe("xai server-tools gates for Grok 4.3", () => {
  test("grok-4.3 supports server-side tools (xSearch, codeExecution)", () => {
    expect(supportsServerTools("grok-4.3")).toBe(true)
    expect(supportsServerTools("grok-4-3")).toBe(true)
  })

  test("grok-4.3 supports reasoning", () => {
    expect(supportsReasoning("grok-4.3")).toBe(true)
    expect(supportsReasoning("grok-4-3")).toBe(true)
  })

  test("multi-agent grok-4 variants still opt out of server tools", () => {
    expect(supportsServerTools("grok-4.20-multi-agent-0309")).toBe(false)
  })
})
