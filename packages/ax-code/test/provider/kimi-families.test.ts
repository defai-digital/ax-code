import { describe, expect, test } from "vitest"
import { kimiFamilyId, kimiFallbackModels, latestKimiFamilyModels } from "../../src/provider/kimi-families"

describe("kimi families", () => {
  test("picks K3 over the 256k variant and coding over highspeed", () => {
    const latest = latestKimiFamilyModels({
      "kimi-code/k3": { id: "kimi-code/k3", name: "K3", family: "kimi-k3", release_date: "2026-08-01" },
      "kimi-code/k3-256k": {
        id: "kimi-code/k3-256k",
        name: "K3-256k",
        family: "kimi-k3",
        release_date: "2026-08-01",
      },
      "kimi-code/kimi-for-coding": {
        id: "kimi-code/kimi-for-coding",
        name: "K2.7 Coding",
        family: "kimi-coding",
        release_date: "2026-06-12",
      },
      "kimi-code/kimi-for-coding-highspeed": {
        id: "kimi-code/kimi-for-coding-highspeed",
        name: "K2.7 Coding Highspeed",
        family: "kimi-coding",
        release_date: "2026-06-12",
      },
      "kimi-cli": { id: "kimi-cli", name: "Kimi Code CLI default", family: "kimi" },
    })
    expect(latest.map((model) => model.id)).toEqual(["kimi-code/k3", "kimi-code/kimi-for-coding"])
  })

  test("falls back to K3 and K2.7 Coding as the CLI family SKUs", () => {
    const fallbacks = kimiFallbackModels()
    const published = latestKimiFamilyModels(Object.fromEntries(fallbacks.map((model) => [model.id, model])))
    expect(published.map((model) => model.id)).toEqual(["kimi-code/k3", "kimi-code/kimi-for-coding"])
    expect(kimiFamilyId({ id: "kimi-code/k3" })).toBe("kimi-k3")
  })
})
