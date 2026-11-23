import { afterEach, expect, test, vi } from "vitest"
import { configuredPins, pinWarnings, registryLookup, type ProviderLookup } from "../../src/cli/cmd/debug/routing"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"

afterEach(() => {
  vi.restoreAllMocks()
})

test("configuredPins lists every configured exact model selection with stable keys", () => {
  const pins = configuredPins({
    model: "gateway/qwen3.8-max",
    small_model: "gateway/glm-5.3",
    wiki: { model: "gateway/xiaomi/mimo-v2.6-pro" },
    experimental: { planner_architect_model: "gateway/glm-5.3" },
    agent: { build: { model: "gateway/qwen3.8-max" }, scout: {} },
    llm_routing: { fallback: [{ providerID: "gateway", modelID: "qwen3.8-max" }] },
  })
  expect(pins).toEqual([
    ["model", "gateway/qwen3.8-max"],
    ["small_model", "gateway/glm-5.3"],
    ["wiki.model", "gateway/xiaomi/mimo-v2.6-pro"],
    ["experimental.planner_architect_model", "gateway/glm-5.3"],
    ["agent.build.model", "gateway/qwen3.8-max"],
    ["llm_routing.fallback[0]", { providerID: "gateway", modelID: "qwen3.8-max" }],
  ])
})

test("configuredPins skips disabled agents, whose pins are never parsed or used", () => {
  expect(
    configuredPins({ agent: { off: { model: "gateway/", disable: true }, on: { model: "gateway/glm-5.3" } } }),
  ).toEqual([["agent.on.model", "gateway/glm-5.3"]])
})

test("configuredPins omits unset keys so configured pin counts stay accurate", () => {
  expect(configuredPins({})).toEqual([])
  expect(configuredPins({ wiki: {}, agent: { scout: {} }, llm_routing: {} })).toEqual([])
})

test("debug routing flags pins whose provider or model is not configured", async () => {
  const providers: Record<string, { status: "ready"; models: Record<string, unknown> }> = {
    gateway: { status: "ready", models: { "qwen3.8-max": {}, "xiaomi/mimo-v2.6-pro": {} } },
  }
  const warnings = await pinWarnings(
    [
      ["model", "alibaba-token-plan/qwen3.8-max"],
      ["small_model", "gateway/deepseek-v4-flash"],
      ["wiki.model", undefined],
      ["agent.build.model", "gateway/qwen3.8-max"],
      ["agent.scout.model", "gateway/xiaomi/mimo-v2.6-pro"],
      ["llm_routing.fallback[0]", { providerID: "gateway", modelID: "toString" }],
    ],
    async (providerID): ReturnType<ProviderLookup> => providers[providerID] ?? { status: "missing" as const },
  )
  expect(warnings).toEqual([
    {
      pin: "model",
      target: "alibaba-token-plan/qwen3.8-max",
      code: "provider_not_configured",
      reason: "provider not configured",
    },
    {
      pin: "small_model",
      target: "gateway/deepseek-v4-flash",
      code: "model_not_found",
      reason: "model not in provider catalog",
    },
    {
      pin: "llm_routing.fallback[0]",
      target: "gateway/toString",
      code: "model_not_found",
      reason: "model not in provider catalog",
    },
  ])
})

test("pinWarnings trims string pins before matching the catalog", async () => {
  const warnings = await pinWarnings(
    [
      ["model", " gateway/glm-5.3"],
      ["small_model", "gateway/glm-5.3 "],
    ],
    async () => ({ status: "ready", models: { "glm-5.3": {} } }),
  )
  expect(warnings).toEqual([])
})

test("pinWarnings reports unparseable pins without consulting the catalog", async () => {
  const warnings = await pinWarnings(
    [
      ["model", "glm-5.3"],
      ["small_model", "gateway/"],
    ],
    async () => {
      throw new Error("lookup must not run for unparseable pins")
    },
  )
  expect(warnings).toEqual([
    { pin: "model", target: "glm-5.3", code: "invalid_format", reason: "invalid model format" },
    { pin: "small_model", target: "gateway/", code: "invalid_format", reason: "invalid model format" },
  ])
})

test("pinWarnings keeps a pin whose model is present even when the catalog is incomplete", async () => {
  const warnings = await pinWarnings(
    [
      ["model", "gateway/glm-5.3"],
      ["small_model", "gateway/missing"],
    ],
    async (providerID) => (providerID === "gateway" ? { status: "incomplete", models: { "glm-5.3": {} } } : undefined),
  )
  expect(warnings).toEqual([
    {
      pin: "small_model",
      target: "gateway/missing",
      code: "catalog_unavailable",
      reason: "catalog unavailable",
    },
  ])
})

test.each([
  ["configured-blacklist", "excluded by provider blacklist"],
  ["outside-configured-whitelist", "excluded by provider whitelist"],
  ["deprecated-model", "excluded: deprecated model"],
  ["experimental-model-disabled", "excluded: experimental models disabled"],
  ["some-other-policy", "excluded by model policy"],
] as const)("pinWarnings maps the exclusion reason %s to %s", async (excludeReason, reason) => {
  const warnings = await pinWarnings([["model", "gateway/glm-5.3"]], async () => ({
    status: "ready",
    models: { "glm-5.3": {} },
    exclusion: () => excludeReason,
  }))
  expect(warnings).toEqual([{ pin: "model", target: "gateway/glm-5.3", code: "excluded", reason, excludeReason }])
})

test("pinWarnings reports an excluded pin even when its provider is missing", async () => {
  const warnings = await pinWarnings([["model", "gateway/glm-5.3"]], async () => ({
    status: "missing",
    exclusion: () => "configured-blacklist",
  }))
  expect(warnings).toEqual([
    {
      pin: "model",
      target: "gateway/glm-5.3",
      code: "excluded",
      reason: "excluded by provider blacklist",
      excludeReason: "configured-blacklist",
    },
  ])
})

test("pinWarnings reports an excluded pin even when the catalog is incomplete", async () => {
  const warnings = await pinWarnings([["model", "gateway/glm-5.3"]], async () => ({
    status: "incomplete",
    models: {},
    exclusion: () => "configured-blacklist",
  }))
  expect(warnings).toEqual([
    {
      pin: "model",
      target: "gateway/glm-5.3",
      code: "excluded",
      reason: "excluded by provider blacklist",
      excludeReason: "configured-blacklist",
    },
  ])
})

function mockRegistry(input: {
  health: { all: boolean; failed: string[]; completed: string[] }
  exclusions?: { providerID: string; modelID: string; reason: string }[]
  config?: Record<string, unknown>
  provider?: { models: Record<string, unknown> } | undefined
  enabled?: string[]
  disabled?: string[]
}) {
  const ready = vi.spyOn(Provider, "ready").mockResolvedValue(undefined)
  const catalogHealth = vi.spyOn(Provider, "catalogHealth").mockResolvedValue({
    all: input.health.all,
    failed: new Set(input.health.failed),
    completed: new Set(input.health.completed),
  })
  const snapshot = vi.spyOn(Provider, "snapshot").mockResolvedValue({
    exclusions: input.exclusions ?? [],
  } as unknown as Awaited<ReturnType<typeof Provider.snapshot>>)
  const getProvider = vi.spyOn(Provider, "getProvider").mockImplementation(async () => input.provider as never)
  const config = vi.spyOn(Config, "get").mockResolvedValue({
    provider: input.config ?? {},
    ...(input.enabled ? { enabled_providers: input.enabled } : {}),
    ...(input.disabled ? { disabled_providers: input.disabled } : {}),
  } as unknown as Awaited<ReturnType<typeof Config.get>>)
  return { ready, catalogHealth, snapshot, getProvider, config }
}

test("registryLookup treats a completed discovery as superseding an earlier failure", async () => {
  mockRegistry({
    health: { all: false, failed: ["gateway"], completed: ["gateway"] },
    provider: { models: { m: {} } },
  })
  const lookup = registryLookup()
  const result = await lookup("gateway")
  expect(result?.status).toBe("ready")
  expect(result?.models).toEqual({ m: {} })
})

test("registryLookup reports a failed, unfinished catalog as incomplete", async () => {
  mockRegistry({
    health: { all: false, failed: ["gateway"], completed: [] },
    provider: { models: { m: {} } },
  })
  const result = await registryLookup()("gateway")
  expect(result?.status).toBe("incomplete")
})

test("registryLookup scopes a whole-run discovery failure to discovery-scheduled ids", async () => {
  mockRegistry({
    health: { all: true, failed: [], completed: ["gateway"] },
    provider: { models: { m: {} } },
  })
  const lookup = registryLookup()
  expect((await lookup("gateway"))?.status).toBe("ready")
  // A static-catalog provider was never scheduled for discovery (absent from
  // `failed`), so the whole-run failure cannot make its catalog incomplete.
  expect((await lookup("static-box"))?.status).toBe("ready")

  vi.restoreAllMocks()
  mockRegistry({
    health: { all: true, failed: ["gw2"], completed: [] },
    provider: { models: { m: {} } },
  })
  expect((await registryLookup()("gw2"))?.status).toBe("incomplete")
})

test("a typo provider id stays provider_not_configured on a whole-run failure", async () => {
  mockRegistry({
    health: { all: true, failed: [], completed: [] },
    provider: undefined,
  })
  expect(await pinWarnings([["model", "openia/gpt-5"]], registryLookup())).toEqual([
    { pin: "model", target: "openia/gpt-5", code: "provider_not_configured", reason: "provider not configured" },
  ])
})

test("registryLookup sees a config blacklist even when the provider is absent", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: [] },
    config: { gateway: { blacklist: ["gone"] } },
    provider: undefined,
  })
  const result = await registryLookup()("gateway")
  expect(result?.status).toBe("missing")
  expect(result?.exclusion?.("gone")).toBe("configured-blacklist")
})

test("registryLookup reports a config whitelist miss only while the catalog cannot be checked", async () => {
  mockRegistry({
    health: { all: false, failed: ["gateway"], completed: [] },
    config: { gateway: { whitelist: ["kept"] } },
    provider: { models: { kept: {} } },
  })
  const incomplete = await registryLookup()("gateway")
  expect(incomplete?.exclusion?.("other")).toBe("outside-configured-whitelist")
  expect(incomplete?.exclusion?.("kept")).toBeUndefined()

  // With a complete catalog, a typo that was never loaded is not found, not excluded.
  vi.restoreAllMocks()
  mockRegistry({
    health: { all: false, failed: [], completed: ["gateway"] },
    config: { gateway: { whitelist: ["kept"] } },
    provider: { models: { kept: {} } },
  })
  expect(await pinWarnings([["model", "gateway/typo"]], registryLookup())).toEqual([
    { pin: "model", target: "gateway/typo", code: "model_not_found", reason: "model not in provider catalog" },
  ])
})

test("registryLookup prefers the reason the registry recorded over config lists", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: ["gateway"] },
    config: { gateway: { blacklist: ["old"] } },
    exclusions: [{ providerID: "gateway", modelID: "old", reason: "unsupported-model-policy" }],
    provider: { models: {} },
  })
  expect((await registryLookup()("gateway"))?.exclusion?.("old")).toBe("unsupported-model-policy")
})

test("registryLookup distrusts a status exclusion for an offline local runtime", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: [] },
    config: { ollama: {} },
    exclusions: [{ providerID: "ollama", modelID: "llama3", reason: "deprecated-model" }],
    provider: undefined,
  })
  const result = await registryLookup()("ollama")
  expect(result?.status).toBe("incomplete")
  expect(result?.exclusion?.("llama3")).toBeUndefined()
})

test("registryLookup reports a local runtime that completed discovery but was dropped as ready with an empty catalog", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: ["ollama"] },
    config: { ollama: {} },
    provider: undefined,
  })
  const result = await registryLookup()("ollama")
  expect(result?.status).toBe("ready")
  expect(result?.models).toEqual({})
  expect(await pinWarnings([["model", "ollama/llama3"]], registryLookup())).toEqual([
    { pin: "model", target: "ollama/llama3", code: "model_not_found", reason: "model not in provider catalog" },
  ])
})

test("registryLookup does not let a whitelist explain a typo on a completed, dropped local runtime", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: ["ollama"] },
    config: { ollama: { whitelist: ["kept"] } },
    provider: undefined,
  })
  const result = await registryLookup()("ollama")
  expect(result?.status).toBe("ready")
  expect(result?.exclusion?.("typo")).toBeUndefined()
})

test("registryLookup keeps a completed, dropped non-runtime provider missing", async () => {
  // Private GPU (no token) and CLI providers (no binary) can complete
  // discovery with `{}` without contacting anything, so an empty completed
  // catalog only proves absence for a local runtime.
  mockRegistry({
    health: { all: false, failed: [], completed: ["custom-private-gpu"] },
    config: { "custom-private-gpu": {} },
    provider: undefined,
  })
  expect(await pinWarnings([["model", "custom-private-gpu/my-model"]], registryLookup())).toEqual([
    {
      pin: "model",
      target: "custom-private-gpu/my-model",
      code: "provider_not_configured",
      reason: "provider not configured",
    },
  ])
})

test("registryLookup lets a whitelist explain a pin on a completed, dropped non-runtime provider", async () => {
  // Its empty completed catalog is not verified (the loader can complete
  // with `{}` without contacting anything), so the catalog cannot be checked
  // and a config whitelist miss still explains the pin as excluded.
  mockRegistry({
    health: { all: false, failed: [], completed: ["custom-private-gpu"] },
    config: { "custom-private-gpu": { whitelist: ["kept"] } },
    provider: undefined,
  })
  const lookup = registryLookup()
  const result = await lookup("custom-private-gpu")
  expect(result?.status).toBe("missing")
  expect(result?.exclusion?.("blocked")).toBe("outside-configured-whitelist")
  expect(await pinWarnings([["model", "custom-private-gpu/blocked"]], lookup)).toEqual([
    {
      pin: "model",
      target: "custom-private-gpu/blocked",
      code: "excluded",
      reason: "excluded by provider whitelist",
      excludeReason: "outside-configured-whitelist",
    },
  ])
})

test("registryLookup honours an explicit config blacklist even with a complete catalog", async () => {
  // An AX Trust refresh can rebuild the catalog without a blacklisted alias
  // and clear its recorded reason; the explicit entry still explains the pin.
  mockRegistry({
    health: { all: false, failed: [], completed: ["gateway"] },
    config: { gateway: { blacklist: ["alias"], whitelist: ["kept"] } },
    provider: { models: { kept: {} } },
  })
  const result = await registryLookup()("gateway")
  expect(result?.exclusion?.("alias")).toBe("configured-blacklist")
  expect(result?.exclusion?.("typo")).toBeUndefined()
})

test("registryLookup reports a disabled provider as missing without config-list exclusions", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: [] },
    config: { ollama: { whitelist: ["other"] } },
    provider: undefined,
    disabled: ["ollama"],
  })
  const result = await registryLookup()("ollama")
  expect(result?.status).toBe("missing")
  expect(result?.exclusion?.("llama3")).toBeUndefined()
  expect(await pinWarnings([["model", "ollama/llama3"]], registryLookup())).toEqual([
    { pin: "model", target: "ollama/llama3", code: "provider_not_configured", reason: "provider not configured" },
  ])
})

test("registryLookup reports a provider outside enabled_providers as missing without exclusions", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: [] },
    config: { gateway: { blacklist: ["m"] } },
    provider: undefined,
    enabled: ["other"],
  })
  const result = await registryLookup()("gateway")
  expect(result?.status).toBe("missing")
  expect(result?.exclusion?.("m")).toBeUndefined()
})

test("registryLookup uses a registry exclusion with a complete catalog", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: ["gateway"] },
    exclusions: [{ providerID: "gateway", modelID: "old", reason: "deprecated-model" }],
    provider: { models: {} },
  })
  expect((await registryLookup()("gateway"))?.exclusion?.("old")).toBe("deprecated-model")
})

test("registryLookup ignores a status exclusion while the catalog is incomplete", async () => {
  mockRegistry({
    health: { all: false, failed: ["gateway"], completed: [] },
    exclusions: [{ providerID: "gateway", modelID: "old", reason: "deprecated-model" }],
    provider: { models: {} },
  })
  expect((await registryLookup()("gateway"))?.exclusion?.("old")).toBeUndefined()
})

test("registryLookup feeds a deprecated exclusion to pinWarnings only when the catalog is complete", async () => {
  const exclusions = [{ providerID: "gateway", modelID: "old", reason: "deprecated-model" }]
  mockRegistry({ health: { all: false, failed: [], completed: ["gateway"] }, exclusions, provider: { models: {} } })
  expect(await pinWarnings([["model", "gateway/old"]], registryLookup())).toEqual([
    {
      pin: "model",
      target: "gateway/old",
      code: "excluded",
      reason: "excluded: deprecated model",
      excludeReason: "deprecated-model",
    },
  ])

  vi.restoreAllMocks()
  mockRegistry({ health: { all: false, failed: ["gateway"], completed: [] }, exclusions, provider: { models: {} } })
  expect(await pinWarnings([["model", "gateway/old"]], registryLookup())).toEqual([
    { pin: "model", target: "gateway/old", code: "catalog_unavailable", reason: "catalog unavailable" },
  ])
})

test("registryLookup memoizes catalog health, snapshot, and config once per closure", async () => {
  const spies = mockRegistry({
    health: { all: false, failed: [], completed: [] },
    provider: { models: {} },
  })
  const lookup = registryLookup()
  await lookup("a")
  await lookup("b")
  await lookup("c")
  expect(spies.ready).toHaveBeenCalledTimes(1)
  expect(spies.catalogHealth).toHaveBeenCalledTimes(1)
  expect(spies.snapshot).toHaveBeenCalledTimes(1)
  expect(spies.config).toHaveBeenCalledTimes(1)
  expect(spies.getProvider).toHaveBeenCalledTimes(3)
})

test("registryLookup treats an opted-in offline local runtime as incomplete", async () => {
  mockRegistry({
    health: { all: false, failed: [], completed: [] },
    config: { ollama: {} },
    provider: undefined,
  })
  const lookup = registryLookup()
  expect((await lookup("ollama"))?.status).toBe("incomplete")
  expect((await lookup("unknown"))?.status).toBe("missing")
})

test("registryLookup keeps a never-enabled or disabled local runtime as not configured", async () => {
  mockRegistry({ health: { all: false, failed: [], completed: [] }, provider: undefined })

  // Never opted in: starting a local server would not register it.
  vi.spyOn(Config, "get").mockResolvedValue({} as unknown as Awaited<ReturnType<typeof Config.get>>)
  expect((await registryLookup()("ollama"))?.status).toBe("missing")

  // Opted in through enabled_providers, but also disabled.
  vi.spyOn(Config, "get").mockResolvedValue({
    enabled_providers: ["ollama"],
    disabled_providers: ["ollama"],
  } as unknown as Awaited<ReturnType<typeof Config.get>>)
  expect((await registryLookup()("ollama"))?.status).toBe("missing")

  // Opted in through enabled_providers and allowed.
  vi.spyOn(Config, "get").mockResolvedValue({
    enabled_providers: ["ollama"],
  } as unknown as Awaited<ReturnType<typeof Config.get>>)
  expect((await registryLookup()("ollama"))?.status).toBe("incomplete")

  // local-llm has no default host: enabled without a host it is never probed.
  vi.spyOn(Config, "get").mockResolvedValue({
    enabled_providers: ["local-llm"],
  } as unknown as Awaited<ReturnType<typeof Config.get>>)
  vi.stubEnv("LOCAL_LLM_HOST", "")
  expect((await registryLookup()("local-llm"))?.status).toBe("missing")
  vi.unstubAllEnvs()
})
