import { describe, expect, test } from "bun:test"
import { normalizeModelVariantStore, resolveCurrentAgent } from "../../../src/cli/cmd/tui/context/local-util"

describe("tui local agent selection", () => {
  test("preserves pending startup agent name until agents load", () => {
    const result = resolveCurrentAgent<{ name: string; displayName: string; model?: undefined }>([], "perf")
    expect(result).toEqual({
      name: "perf",
      displayName: "Agent",
    })
  })

  test("returns the exact matching agent when present", () => {
    const result = resolveCurrentAgent(
      [
        { name: "build", displayName: "Build" },
        { name: "perf", displayName: "Perf" },
      ],
      "perf",
    )
    expect(result).toEqual({
      name: "perf",
      displayName: "Perf",
    })
  })

  test("falls back to the first available agent when the pending name is invalid", () => {
    const result = resolveCurrentAgent(
      [
        { name: "build", displayName: "Build" },
        { name: "plan", displayName: "Plan" },
      ],
      "missing",
    )
    expect(result).toEqual({
      name: "build",
      displayName: "Build",
    })
  })
})

describe("tui local model preferences", () => {
  test("normalizes stored model variants to string values", () => {
    expect(
      normalizeModelVariantStore({
        "openai/gpt-5": "high",
        "xai/grok-code-fast-1": undefined,
        "anthropic/claude": 42,
        nested: { value: "bad" },
      }),
    ).toEqual({
      "openai/gpt-5": "high",
      "xai/grok-code-fast-1": undefined,
    })
  })

  test("rejects non-object or array variant stores", () => {
    expect(normalizeModelVariantStore(null)).toEqual({})
    expect(normalizeModelVariantStore(["openai/gpt-5"])).toEqual({})
    expect(normalizeModelVariantStore("openai/gpt-5")).toEqual({})
  })
})
