import { describe, expect, test } from "vitest"
import { modelIdFinalSegment, normalizeProviderModelId } from "../../src/provider/model-id"

describe("modelIdFinalSegment", () => {
  test("returns the last non-empty path segment", () => {
    expect(modelIdFinalSegment("grok-4.5")).toBe("grok-4.5")
    expect(modelIdFinalSegment("x-ai/grok-4.5")).toBe("grok-4.5")
    expect(modelIdFinalSegment("accounts/foo/glm-5.2")).toBe("glm-5.2")
  })

  test("skips empty segments from double slashes", () => {
    expect(modelIdFinalSegment("x-ai//grok-4.5")).toBe("grok-4.5")
    expect(modelIdFinalSegment("")).toBe("")
  })
})

describe("normalizeProviderModelId", () => {
  test("lowercases and strips separators for fuzzy match", () => {
    expect(normalizeProviderModelId("Grok-4.5")).toBe("grok45")
    expect(normalizeProviderModelId("glm_5.2")).toBe("glm52")
  })
})
