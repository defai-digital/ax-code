import { describe, expect, test } from "vitest"
import {
  minimaxDisplayName,
  minimaxFamilyId,
  minimaxFallbackLatest,
  latestMiniMaxFamilyModels,
} from "../../src/provider/minimax-families"

describe("minimax families", () => {
  test("picks MiniMax-M3 over M2.7 and skips highspeed", () => {
    const latest = latestMiniMaxFamilyModels({
      "MiniMax-M2.7": {
        id: "MiniMax-M2.7",
        name: "MiniMax-M2.7",
        family: "minimax",
        release_date: "2026-03-18",
      },
      "MiniMax-M2.7-highspeed": {
        id: "MiniMax-M2.7-highspeed",
        name: "MiniMax-M2.7 Highspeed",
        family: "minimax",
        release_date: "2026-03-18",
      },
      "MiniMax-M3": {
        id: "MiniMax-M3",
        name: "MiniMax-M3",
        family: "minimax",
        release_date: "2026-06-01",
      },
      "minimax-cli": {
        id: "minimax-cli",
        name: "MiniMax Code CLI default",
        family: "minimax",
      },
    })
    expect(latest.map((model) => model.id.split("/").pop())).toEqual(["MiniMax-M3", "MiniMax-M2.7"])
  })

  test("falls back to MiniMax-M3 as the current MiniMax SKU", () => {
    const fallback = minimaxFallbackLatest()
    expect(fallback.id).toBe("MiniMax-M3")
    expect(minimaxFamilyId(fallback)).toBe("minimax-m3")
    expect(minimaxDisplayName("OpenRouter: MiniMax-M3", "MiniMax-M3")).toBe("MiniMax-M3")
    expect(minimaxFamilyId({ id: "minimax-cli" })).toBeUndefined()
  })
})
