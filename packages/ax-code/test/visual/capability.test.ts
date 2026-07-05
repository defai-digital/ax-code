import { describe, expect, test } from "vitest"
import {
  hasVisualCapabilities,
  missingCapabilityDiagnostic,
  type ModelVisualCapabilities,
} from "../../src/visual/capability"

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
})
