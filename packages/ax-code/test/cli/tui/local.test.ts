import { describe, expect, test } from "vitest"
import {
  RECENT_MODEL_LIMIT,
  modelPreferenceStatus,
  normalizeModelVariantStore,
  normalizeRecentModels,
  pruneModelPreferences,
  rememberRecentModel,
  resolveCurrentAgent,
} from "../../../src/cli/cmd/tui/context/local-util"

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
  function model(n: number) {
    return { providerID: "provider", modelID: `model-${n}` }
  }

  test("normalizes stored model variants to string values", () => {
    expect(
      normalizeModelVariantStore({
        "openai/gpt-5": "high",
        "groq/qwen3.6-27b": undefined,
        "anthropic/claude": 42,
        nested: { value: "bad" },
      }),
    ).toEqual({
      "openai/gpt-5": "high",
      "groq/qwen3.6-27b": undefined,
    })
  })

  test("rejects non-object or array variant stores", () => {
    expect(normalizeModelVariantStore(null)).toEqual({})
    expect(normalizeModelVariantStore(["openai/gpt-5"])).toEqual({})
    expect(normalizeModelVariantStore("openai/gpt-5")).toEqual({})
  })

  test("normalizes stored recent models to the most recent five entries", () => {
    expect(normalizeRecentModels([model(1), model(2), model(3), model(4), model(5), model(6)])).toEqual([
      model(1),
      model(2),
      model(3),
      model(4),
      model(5),
    ])
  })

  test("rememberRecentModel keeps the current model first and caps the list at five", () => {
    const result = rememberRecentModel([model(1), model(2), model(3), model(4), model(5)], model(3))

    expect(result).toEqual([model(3), model(1), model(2), model(4), model(5)])
    expect(result).toHaveLength(RECENT_MODEL_LIMIT)
  })

  test("pruneModelPreferences removes invalid stored model selections after providers load", () => {
    const valid = new Set(["provider/model-1", "provider/model-3", "openrouter/vendor/model"])
    const result = pruneModelPreferences(
      {
        recent: [model(1), { providerID: "missing", modelID: "model-2" }, model(3), model(1)],
        favorite: [model(3), { providerID: "missing", modelID: "model-4" }],
        variant: {
          "provider/model-1": "high",
          "missing/model-2": "low",
          "openrouter/vendor/model": "medium",
          malformed: "ignored",
        },
      },
      (item) => (valid.has(`${item.providerID}/${item.modelID}`) ? "valid" : "invalid"),
    )

    expect(result.recent).toEqual([model(1), model(3)])
    expect(result.favorite).toEqual([model(3)])
    expect(result.variant).toEqual({
      "provider/model-1": "high",
      "openrouter/vendor/model": "medium",
    })
    expect(result.changed).toBe(true)
  })

  test("pruneModelPreferences keeps models that are temporarily unavailable during provider discovery", () => {
    const discovered = { providerID: "codex-cli", modelID: "gpt-5.6-sol" }
    const invalid = { providerID: "missing", modelID: "removed" }
    const providers = [
      {
        id: "codex-cli",
        models: {
          "codex-cli": { capabilities: { toolcall: true } },
        },
      },
      {
        id: "provider",
        models: {
          "model-1": { capabilities: { toolcall: true } },
        },
      },
    ]
    const result = pruneModelPreferences(
      {
        recent: [discovered, invalid, model(1)],
        favorite: [discovered, invalid],
        variant: {
          "codex-cli/gpt-5.6-sol": "high",
          "missing/removed": "stale",
        },
      },
      (item) => modelPreferenceStatus(providers, item),
      (item) => modelPreferenceStatus(providers, item),
    )

    expect(result.recent).toEqual([discovered, model(1)])
    expect(result.favorite).toEqual([discovered])
    expect(result.variant).toEqual({
      "codex-cli/gpt-5.6-sol": "high",
    })
    expect(result.changed).toBe(true)
  })

  test("pruneModelPreferences removes stale variants for otherwise valid models", () => {
    const valid = new Set(["provider/model-1", "provider/model-2", "provider/model-3"])
    const validVariants = new Map([
      ["provider/model-1", new Set(["high"])],
      ["provider/model-2", new Set(["low", "medium"])],
    ])
    const result = pruneModelPreferences(
      {
        recent: [model(1), model(2), model(3)],
        favorite: [model(1)],
        variant: {
          "provider/model-1": "high",
          "provider/model-2": "stale",
          "provider/model-3": "orphaned",
        },
      },
      (item) => (valid.has(`${item.providerID}/${item.modelID}`) ? "valid" : "invalid"),
      (item, variant) => {
        if (variant === undefined) return "valid"
        return validVariants.get(`${item.providerID}/${item.modelID}`)?.has(variant) ? "valid" : "invalid"
      },
    )

    expect(result.recent).toEqual([model(1), model(2), model(3)])
    expect(result.favorite).toEqual([model(1)])
    expect(result.variant).toEqual({
      "provider/model-1": "high",
    })
    expect(result.changed).toBe(true)
  })
})
