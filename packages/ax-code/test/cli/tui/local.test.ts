import { describe, expect, test } from "vitest"
import {
  RECENT_MODEL_LIMIT,
  SESSION_MODEL_LIMIT,
  modelPreferenceStatus,
  normalizeModelOverrides,
  normalizeSessionModelPreferences,
  normalizeModelVariantStore,
  normalizeRecentModels,
  pruneModelPreferences,
  pruneSessionModelPreferences,
  rememberSessionModelPreference,
  sessionModelPreference,
  applyExplicitModelPreference,
  hasSessionModelPreference,
  shouldAdoptMessageModelFromHistory,
  solidStoreRecordPatch,
  rememberRecentModel,
  resolveCurrentAgent,
  resolvePinnedModelPreference,
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

  test("normalizes stored per-agent model overrides to valid entries", () => {
    expect(
      normalizeModelOverrides({
        build: model(1),
        plan: { providerID: "provider", modelID: "model-2" },
        bad: "not-an-object",
        empty: "",
        nested: { value: "bad" },
      }),
    ).toEqual({
      build: model(1),
      plan: { providerID: "provider", modelID: "model-2" },
    })
  })

  test("rejects non-object or array model override stores", () => {
    expect(normalizeModelOverrides(null)).toEqual({})
    expect(normalizeModelOverrides([model(1)])).toEqual({})
    expect(normalizeModelOverrides("openai/gpt-5")).toEqual({})
  })

  test("restores the latest model per session and agent without changing global overrides", () => {
    const qwen = model(1)
    const minimax = model(2)
    const globalOverrides = { build: qwen, architect: minimax }
    let sessions = rememberSessionModelPreference({}, "session-1", "build", qwen)
    sessions = rememberSessionModelPreference(sessions, "session-1", "architect", qwen)

    expect(sessionModelPreference(sessions, "session-1", "architect")).toEqual(qwen)
    expect(sessionModelPreference(sessions, "session-1", "build")).toEqual(qwen)
    expect(sessionModelPreference(sessions, "session-1", "debug")).toEqual(qwen)
    expect(sessionModelPreference(sessions, "session-2", "architect")).toBeUndefined()
    expect(globalOverrides.architect).toEqual(minimax)
  })

  test("keeps an explicit in-session pick out of the global agent override", () => {
    const qwen = model(1)
    const minimax = model(2)
    const global = { build: qwen }
    const applied = applyExplicitModelPreference({}, global, "session-1", "build", minimax)

    expect(sessionModelPreference(applied.sessions, "session-1", "build")).toEqual(minimax)
    expect(applied.global).toBe(global)
    expect(applied.global.build).toEqual(qwen)
    expect(sessionModelPreference(applied.sessions, "session-2", "build")).toBeUndefined()
  })

  test("writes a home-screen pick to the global override so --model still applies", () => {
    const qwen = model(1)
    const minimax = model(2)
    const applied = applyExplicitModelPreference({}, { build: qwen }, undefined, "build", minimax)

    expect(applied.sessions).toEqual({})
    expect(applied.global).toEqual({ build: minimax })
  })

  test("does not restore last-message models over an existing session pick", () => {
    const sessions = rememberSessionModelPreference({}, "session-1", "build", model(2))

    expect(hasSessionModelPreference(sessions, "session-1")).toBe(true)
    expect(hasSessionModelPreference(sessions, "session-2")).toBe(false)
    expect(shouldAdoptMessageModelFromHistory(true, true)).toBe(false)
    expect(shouldAdoptMessageModelFromHistory(true, false)).toBe(true)
    expect(shouldAdoptMessageModelFromHistory(false, true)).toBe(true)
  })

  test("normalizes and caps persisted session model preferences", () => {
    const input = Object.fromEntries(
      Array.from({ length: SESSION_MODEL_LIMIT + 1 }, (_, index) => [
        `session-${index}`,
        {
          model: model(index),
          agents: {
            build: model(index),
            invalid: "bad",
          },
        },
      ]),
    )
    const result = normalizeSessionModelPreferences(input)

    expect(Object.keys(result)).toHaveLength(SESSION_MODEL_LIMIT)
    expect(result["session-0"]).toBeUndefined()
    expect(result["session-1"]?.agents).toEqual({ build: model(1) })
    expect(normalizeSessionModelPreferences(null)).toEqual({})
  })

  test("keeps session model preferences in most-recently-used order within the cap", () => {
    let sessions = normalizeSessionModelPreferences({})
    for (let index = 0; index <= SESSION_MODEL_LIMIT; index++) {
      sessions = rememberSessionModelPreference(sessions, `session-${index}`, "build", model(index))
    }

    expect(Object.keys(sessions)).toHaveLength(SESSION_MODEL_LIMIT)
    expect(sessions["session-0"]).toBeUndefined()

    sessions = rememberSessionModelPreference(sessions, "session-1", "build", model(1))
    expect(Object.keys(sessions).at(-1)).toBe("session-1")
  })

  test("prunes invalid session models while retaining valid agent selections", () => {
    const result = pruneSessionModelPreferences(
      {
        "session-1": {
          model: { providerID: "missing", modelID: "removed" },
          agents: {
            build: model(1),
            architect: { providerID: "missing", modelID: "removed" },
          },
        },
        "session-2": {
          agents: {
            debug: { providerID: "missing", modelID: "removed" },
          },
        },
      },
      (selection) => (selection.providerID === "provider" ? "valid" : "invalid"),
    )

    expect(result.value).toEqual({
      "session-1": {
        model: undefined,
        agents: { build: model(1) },
      },
    })
    expect(result.changed).toBe(true)
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
        model: {
          build: model(1),
          plan: { providerID: "missing", modelID: "model-2" },
          explore: model(3),
        },
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

    expect(result.model).toEqual({
      build: model(1),
      explore: model(3),
    })
    expect(result.recent).toEqual([model(1), model(3)])
    expect(result.favorite).toEqual([model(3)])
    expect(result.variant).toEqual({
      "provider/model-1": "high",
      "openrouter/vendor/model": "medium",
    })
    expect(result.changed).toBe(true)
    expect(solidStoreRecordPatch({ build: model(1), plan: model(2) }, { build: model(1) })).toEqual({
      build: model(1),
      plan: undefined,
    })
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
        model: {
          build: discovered,
          plan: invalid,
        },
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

    expect(result.model).toEqual({
      build: discovered,
    })
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
        model: {
          build: model(1),
        },
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

    expect(result.model).toEqual({
      build: model(1),
    })
    expect(result.recent).toEqual([model(1), model(2), model(3)])
    expect(result.favorite).toEqual([model(1)])
    expect(result.variant).toEqual({
      "provider/model-1": "high",
    })
    expect(result.changed).toBe(true)
  })
})

describe("pruneModelPreferences migration", () => {
  test("moves preferences to the same SKU on a connected provider instead of deleting them", () => {
    const valid = new Set(["gateway/deepseek-v4-pro", "gateway/glm-5.3"])
    const status = (item: { providerID: string; modelID: string }) =>
      valid.has(`${item.providerID}/${item.modelID}`) ? ("valid" as const) : ("invalid" as const)
    const migrate = (item: { providerID: string; modelID: string }) =>
      item.providerID === "deepseek" && item.modelID === "deepseek-v4-pro"
        ? { providerID: "gateway", modelID: "deepseek-v4-pro" }
        : undefined
    const pinned = { providerID: "deepseek", modelID: "deepseek-v4-pro" }
    const gone = { providerID: "alibaba-token-plan", modelID: "qwen3.8-max" }
    const glm = { providerID: "gateway", modelID: "glm-5.3" }
    const moved = { providerID: "gateway", modelID: "deepseek-v4-pro" }

    const result = pruneModelPreferences(
      {
        model: { build: pinned, plan: gone, explore: glm },
        recent: [pinned, moved, gone, glm],
        favorite: [pinned, gone],
        variant: {
          "deepseek/deepseek-v4-pro": "high",
          "alibaba-token-plan/qwen3.8-max": "low",
          "gateway/glm-5.3": "medium",
        },
      },
      status,
      status,
      migrate,
    )

    expect(result.changed).toBe(true)
    expect(result.model).toEqual({ build: moved, explore: glm })
    expect(result.recent).toEqual([moved, glm])
    expect(result.favorite).toEqual([moved])
    expect(result.variant).toEqual({ "gateway/deepseek-v4-pro": "high", "gateway/glm-5.3": "medium" })
  })
})

describe("resolvePinnedModelPreference", () => {
  const providers = [
    {
      id: "127.0.0.1",
      models: {
        "deepseek-v4-pro": { capabilities: { toolcall: true } },
      },
    },
  ]

  test("keeps a model that is already valid on its own provider", () => {
    expect(resolvePinnedModelPreference(providers, { providerID: "127.0.0.1", modelID: "deepseek-v4-pro" })).toEqual({
      providerID: "127.0.0.1",
      modelID: "deepseek-v4-pro",
    })
  })

  test("follows a disabled native provider pin to the connected SKU", () => {
    expect(resolvePinnedModelPreference(providers, { providerID: "deepseek", modelID: "deepseek-v4-pro" })).toEqual({
      providerID: "127.0.0.1",
      modelID: "deepseek-v4-pro",
    })
  })

  test("returns undefined when the SKU is not served by any connected provider", () => {
    expect(resolvePinnedModelPreference(providers, { providerID: "openai", modelID: "gpt-5" })).toBeUndefined()
  })
})
