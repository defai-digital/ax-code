import { describe, expect, test } from "vitest"
import bundledSnapshot from "../../src/provider/models-snapshot.json"
import {
  claudeDisplayName,
  claudeFamilyId,
  claudeFamilySortKey,
  latestAnthropicFamilyModels,
} from "../../src/provider/anthropic-families"

describe("anthropic families", () => {
  test("picks the newest non-dated SKU in each Claude family", () => {
    const latest = latestAnthropicFamilyModels({
      "claude-opus-4-5-20251101": {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        family: "claude-opus",
        release_date: "2025-11-24",
      },
      "claude-opus-4-5": {
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5 (latest)",
        family: "claude-opus",
        release_date: "2025-11-24",
      },
      "claude-opus-5": {
        id: "claude-opus-5",
        name: "Claude Opus 5",
        family: "claude-opus",
        release_date: "2026-07-24",
      },
      "claude-sonnet-4-5-20250929": {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        family: "claude-sonnet",
        release_date: "2025-09-29",
      },
      "claude-sonnet-5": {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        family: "claude-sonnet",
        release_date: "2026-06-29",
      },
      "claude-haiku-4-5": {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5 (latest)",
        family: "claude-haiku",
        release_date: "2025-10-15",
      },
      "claude-fable-5": {
        id: "claude-fable-5",
        name: "Claude Fable 5",
        family: "claude-fable",
        release_date: "2026-06-07",
      },
    })

    expect(latest.map((model) => model.id)).toEqual([
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-fable-5",
    ])
  })

  test("uses the bundled Anthropic catalog's newest family SKUs", () => {
    const anthropic = (
      bundledSnapshot as {
        anthropic?: { models?: Record<string, { id: string; name?: string; family?: string; release_date?: string }> }
      }
    ).anthropic?.models
    expect(anthropic).toBeDefined()
    const latest = latestAnthropicFamilyModels(anthropic!)
    expect(latest.map((model) => model.id)).toEqual([
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-fable-5",
    ])
  })

  test("sorts Claude families Opus, Sonnet, Haiku, Fable", () => {
    expect(claudeFamilyId({ id: "claude-sonnet-5", family: "claude-sonnet" })).toBe("claude-sonnet")
    expect(claudeFamilySortKey("claude-opus")).toBeLessThan(claudeFamilySortKey("claude-sonnet"))
    expect(claudeFamilySortKey("claude-sonnet")).toBeLessThan(claudeFamilySortKey("claude-haiku"))
    expect(claudeFamilySortKey("claude-haiku")).toBeLessThan(claudeFamilySortKey("claude-fable"))
    expect(claudeDisplayName("Claude Haiku 4.5 (latest)", "claude-haiku-4-5")).toBe("Claude Haiku 4.5")
  })
})
