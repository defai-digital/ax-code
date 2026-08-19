import { describe, expect, test } from "vitest"
import bundledSnapshot from "../../src/provider/models-snapshot.json"
import { codexFamilyId, codexFallbackModels, latestCodexFamilyModels } from "../../src/provider/codex-families"

describe("codex families", () => {
  test("picks the newest GPT, mini, and Spark SKUs and hides GPT-5.3 Codex", () => {
    const latest = latestCodexFamilyModels({
      "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4", release_date: "2026-03-05" },
      "gpt-5.6": { id: "gpt-5.6", name: "GPT-5.6", release_date: "2026-07-09" },
      "gpt-5.6-sol": { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", release_date: "2026-07-09" },
      "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 Mini", release_date: "2025-08-07" },
      "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 mini", release_date: "2026-03-17" },
      "gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", release_date: "2026-02-05" },
      "gpt-5.3-codex-spark": { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", release_date: "2026-02-05" },
      "codex-cli": { id: "codex-cli", name: "Codex CLI default" },
    })
    expect(latest.map((model) => model.id)).toEqual(["gpt-5.6", "gpt-5.4-mini", "gpt-5.3-codex-spark"])
    expect(codexFamilyId({ id: "gpt-5.3-codex" })).toBeUndefined()
  })

  test("uses the bundled OpenAI catalog's newest Codex CLI families", () => {
    const openai = (
      bundledSnapshot as {
        openai?: { models?: Record<string, { id: string; name?: string; family?: string; release_date?: string }> }
      }
    ).openai?.models
    expect(openai).toBeDefined()
    expect(latestCodexFamilyModels(openai!).map((model) => model.id)).toEqual([
      "gpt-5.6",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ])
  })

  test("identifies Codex family SKUs without splitting the picker by family", () => {
    expect(codexFamilyId({ id: "gpt-5.6" })).toBe("gpt-flagship")
    expect(codexFallbackModels().map((model) => model.id)).toEqual(["gpt-5.6", "gpt-5.4-mini", "gpt-5.3-codex-spark"])
  })
})
