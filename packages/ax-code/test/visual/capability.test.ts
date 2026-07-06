import { describe, expect, test } from "vitest"
import {
  hasVisualCapabilities,
  missingCapabilityDiagnostic,
  toVisualCapabilities,
  type ModelVisualCapabilities,
} from "../../src/visual/capability"
import type { ProviderModel } from "../../src/provider/model-info"

const fullCaps: ModelVisualCapabilities = {
  toolCall: true,
  visionInput: true,
  jsonSchema: true,
  reasoning: "strong",
  visualUiCritique: true,
  browserActionPlanning: true,
  search: "tool",
  maxImagePixels: 20_000_000,
  maxImagesPerRequest: 10,
}

const textOnlyCaps: ModelVisualCapabilities = {
  toolCall: true,
  visionInput: false,
  jsonSchema: true,
  reasoning: "basic",
  visualUiCritique: false,
  browserActionPlanning: false,
  search: "none",
}

describe("visual.capability", () => {
  describe("hasVisualCapabilities", () => {
    test("returns true when all required capabilities are present", () => {
      expect(hasVisualCapabilities(fullCaps, { visionInput: true, toolCall: true })).toBe(true)
    })

    test("returns false when vision is required but missing", () => {
      expect(hasVisualCapabilities(textOnlyCaps, { visionInput: true })).toBe(false)
    })

    test("returns false when reasoning level is insufficient", () => {
      expect(hasVisualCapabilities(textOnlyCaps, { reasoning: "strong" })).toBe(false)
    })

    test("returns true when reasoning level is sufficient", () => {
      expect(hasVisualCapabilities(fullCaps, { reasoning: "basic" })).toBe(true)
    })

    test("returns true when no capabilities are required", () => {
      expect(hasVisualCapabilities(textOnlyCaps, {})).toBe(true)
    })

    test("checks multiple capabilities together", () => {
      expect(
        hasVisualCapabilities(textOnlyCaps, {
          visionInput: true,
          browserActionPlanning: true,
        }),
      ).toBe(false)
    })
  })

  describe("missingCapabilityDiagnostic", () => {
    test("returns undefined when all capabilities are present", () => {
      const result = missingCapabilityDiagnostic(fullCaps, { visionInput: true }, "test-model")
      expect(result).toBeUndefined()
    })

    test("returns diagnostic for missing vision", () => {
      const result = missingCapabilityDiagnostic(textOnlyCaps, { visionInput: true }, "qwen3.7-max")
      expect(result).toContain("qwen3.7-max")
      expect(result).toContain("vision_input")
    })

    test("returns diagnostic for multiple missing capabilities", () => {
      const result = missingCapabilityDiagnostic(
        textOnlyCaps,
        { visionInput: true, browserActionPlanning: true },
        "qwen-turbo",
      )
      expect(result).toContain("vision_input")
      expect(result).toContain("browser_action_planning")
    })

    test("returns diagnostic for insufficient reasoning level", () => {
      const result = missingCapabilityDiagnostic(textOnlyCaps, { reasoning: "strong" }, "qwen-plus")
      expect(result).toContain("reasoning:strong")
      expect(result).toContain("has: basic")
    })
  })

  describe("toVisualCapabilities", () => {
    function makeModel(overrides: {
      toolcall?: boolean
      image?: boolean
      reasoning?: boolean
      interleaved?: boolean | { field: "reasoning_content" | "reasoning_details" }
    }): ProviderModel {
      return {
        id: "test-model" as any,
        providerID: "test" as any,
        name: "Test Model",
        api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
        capabilities: {
          temperature: false,
          reasoning: overrides.reasoning ?? false,
          attachment: false,
          toolcall: overrides.toolcall ?? false,
          input: {
            text: true,
            audio: false,
            image: overrides.image ?? false,
            video: false,
            pdf: false,
          },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: overrides.interleaved ?? false,
        },
        limit: { context: 128_000, output: 4096 },
        status: "active",
        options: {},
        headers: {},
        release_date: "",
      }
    }

    test("maps vision model correctly", () => {
      const model = makeModel({ toolcall: true, image: true, reasoning: true, interleaved: true })
      const caps = toVisualCapabilities(model)
      expect(caps.visionInput).toBe(true)
      expect(caps.toolCall).toBe(true)
      expect(caps.visualUiCritique).toBe(true)
      expect(caps.browserActionPlanning).toBe(true)
      expect(caps.reasoning).toBe("strong")
    })

    test("maps text-only model correctly", () => {
      const model = makeModel({ toolcall: true, image: false, reasoning: true })
      const caps = toVisualCapabilities(model)
      expect(caps.visionInput).toBe(false)
      expect(caps.visualUiCritique).toBe(false)
      expect(caps.browserActionPlanning).toBe(false)
      expect(caps.reasoning).toBe("basic")
    })

    test("maps model with no reasoning", () => {
      const model = makeModel({ toolcall: false, image: false, reasoning: false })
      const caps = toVisualCapabilities(model)
      expect(caps.reasoning).toBe("none")
      expect(caps.toolCall).toBe(false)
    })

    test("browserActionPlanning requires both toolcall and vision", () => {
      const toolOnly = makeModel({ toolcall: true, image: false })
      expect(toVisualCapabilities(toolOnly).browserActionPlanning).toBe(false)

      const visionOnly = makeModel({ toolcall: false, image: true })
      expect(toVisualCapabilities(visionOnly).browserActionPlanning).toBe(false)

      const both = makeModel({ toolcall: true, image: true })
      expect(toVisualCapabilities(both).browserActionPlanning).toBe(true)
    })

    test("reasoning with interleaved object maps to strong", () => {
      const model = makeModel({ reasoning: true, interleaved: { field: "reasoning_content" } })
      expect(toVisualCapabilities(model).reasoning).toBe("strong")
    })
  })
})
