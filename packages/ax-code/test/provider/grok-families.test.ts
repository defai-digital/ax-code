import { describe, expect, test } from "vitest"
import {
  grokDisplayName,
  grokFamilyId,
  grokFallbackLatest,
  latestGrokFamilyModels,
} from "../../src/provider/grok-families"

describe("grok families", () => {
  test("treats 4.x SKUs as one family and picks the newest", () => {
    const latest = latestGrokFamilyModels({
      "grok-4.5": {
        id: "grok-4.5",
        name: "Grok 4.5",
        family: "grok",
        release_date: "2026-07-08",
      },
      "x-ai/grok-4.6": {
        id: "x-ai/grok-4.6",
        name: "Grok 4.6",
        family: "grok",
        release_date: "2026-08-19",
      },
      "grok-build-cli": {
        id: "grok-build-cli",
        name: "Grok Build CLI default",
        family: "grok",
      },
    })
    expect(latest.map((model) => model.id.split("/").pop())).toEqual(["grok-4.6"])
  })

  test("falls back to grok-4.6 as the current Grok 4 SKU", () => {
    const fallback = grokFallbackLatest()
    expect(fallback.id).toBe("grok-4.6")
    expect(grokFamilyId(fallback)).toBe("grok-4")
    expect(grokDisplayName("OpenRouter: Grok 4.5", "grok-4.5")).toBe("Grok 4.5")
  })
})
