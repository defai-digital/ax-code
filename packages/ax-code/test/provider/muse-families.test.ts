import { describe, expect, test } from "vitest"
import {
  museDisplayName,
  museFamilyId,
  museFallbackLatest,
  latestMuseFamilyModels,
} from "../../src/provider/muse-families"

describe("muse families", () => {
  test("treats Muse Spark SKUs as one family and picks the newest primary", () => {
    const latest = latestMuseFamilyModels({
      "muse-spark-1.2": {
        id: "muse-spark-1.2",
        name: "Muse Spark 1.2",
        family: "muse",
        release_date: "2026-06-01",
      },
      "muse-spark-1.3-contributor": {
        id: "muse-spark-1.3-contributor",
        name: "Muse Spark 1.3 Contributor",
        family: "muse",
        release_date: "2026-09-02",
      },
      "muse-spark-1.3": {
        id: "muse-spark-1.3",
        name: "Muse Spark 1.3",
        family: "muse",
        release_date: "2026-09-02",
      },
      "muse-cli": {
        id: "muse-cli",
        name: "Muse Code CLI default",
        family: "muse",
      },
    })
    expect(latest.map((model) => model.id.split("/").pop())).toEqual(["muse-spark-1.3"])
  })

  test("falls back to muse-spark-1.3 as the current Muse Spark SKU", () => {
    const fallback = museFallbackLatest()
    expect(fallback.id).toBe("muse-spark-1.3")
    expect(museFamilyId(fallback)).toBe("muse-spark")
    expect(museDisplayName("OpenRouter: Muse Spark 1.3", "muse-spark-1.3")).toBe("Muse Spark 1.3")
    expect(museFamilyId({ id: "muse-cli" })).toBeUndefined()
    expect(museFamilyId({ id: "muse-glimmer-30b", family: "muse" })).toBeUndefined()
  })
})
