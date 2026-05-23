import { describe, expect, test } from "bun:test"
import {
  OPENROUTER_SUPPORTED_MODEL_IDS,
  buildModelProbes,
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
