import { afterEach, expect, test, vi } from "vitest"
import { configuredPins, incompleteCatalogs, pinWarnings, registryLookup } from "../../src/cli/cmd/debug/routing"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import type { ProviderID } from "../../src/provider/schema"

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

test("configuredPins omits unset keys so configured pin counts stay accurate", () => {
  expect(configuredPins({})).toEqual([])
  expect(configuredPins({ wiki: {}, agent: { scout: {} }, llm_routing: {} })).toEqual([])
})

test("debug routing flags pins whose provider or model is not configured", async () => {
  const providers: Record<string, { models: Record<string, unknown> }> = {
    gateway: { models: { "qwen3.8-max": {}, "xiaomi/mimo-v2.6-pro": {} } },
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
    async (providerID) => providers[providerID],
  )
  expect(warnings).toEqual([
    { pin: "model", target: "alibaba-token-plan/qwen3.8-max", reason: "provider not configured" },
    { pin: "small_model", target: "gateway/deepseek-v4-flash", reason: "model not in provider catalog" },
    { pin: "llm_routing.fallback[0]", target: "gateway/toString", reason: "model not in provider catalog" },
  ])
})

test("pinWarnings trims string pins before matching the catalog", async () => {
  const providers: Record<string, { models: Record<string, unknown> }> = {
    gateway: { models: { "glm-5.3": {} } },
  }
  const warnings = await pinWarnings(
    [
      ["model", " gateway/glm-5.3"],
      ["small_model", "gateway/glm-5.3 "],
    ],
    async (providerID) => providers[providerID],
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
    { pin: "model", target: "glm-5.3", reason: "invalid model format" },
    { pin: "small_model", target: "gateway/", reason: "invalid model format" },
  ])
})

test("pinWarnings keeps a pin whose model is present even when the catalog is incomplete", async () => {
  const warnings = await pinWarnings(
    [
      ["model", "gateway/glm-5.3"],
      ["small_model", "gateway/missing"],
    ],
    async (providerID) =>
      providerID === "gateway" ? { models: { "glm-5.3": {} }, catalogIncomplete: true } : undefined,
  )
  expect(warnings).toEqual([{ pin: "small_model", target: "gateway/missing", reason: "catalog unavailable" }])
})

test("incompleteCatalogs parses every diagnostic source shape and ignores unknown prefixes", () => {
  const parsed = incompleteCatalogs([
    { source: "discovery:gateway" },
    { source: "loader:lan-box" },
    { source: "plugin-auth:claude-code" },
    { source: "telemetry:unrelated" },
  ])
  expect(parsed.all).toBe(false)
  expect(parsed.providers).toEqual(new Set(["gateway", "lan-box", "claude-code"]))
})

test("incompleteCatalogs marks every provider incomplete when the whole discovery run failed", () => {
  const parsed = incompleteCatalogs([{ source: "discovery" }, { source: "discovery:gateway" }])
  expect(parsed.all).toBe(true)
  expect(parsed.providers).toEqual(new Set(["gateway"]))
})

test("registryLookup judges catalog completeness from diagnostics and offline local runtimes", async () => {
  const ready = vi.spyOn(Provider, "ready").mockResolvedValue(undefined)
  const snapshot = vi.spyOn(Provider, "snapshot").mockResolvedValue({
    discovery: { diagnostics: [{ source: "discovery:lan-box", code: "provider-initialization-failed" }] },
  } as unknown as Awaited<ReturnType<typeof Provider.snapshot>>)
  const getProvider = vi
    .spyOn(Provider, "getProvider")
    .mockImplementation(async (providerID: ProviderID) =>
      String(providerID) === "gateway" ? ({ models: { m: {} } } as never) : undefined,
    )

  vi.spyOn(Config, "get").mockResolvedValue({
    provider: { ollama: {} },
  } as unknown as Awaited<ReturnType<typeof Config.get>>)

  const lookup = registryLookup()
  // A provider whose discovery failed is incomplete even when the failed
  // loader dropped it from the registry.
  expect(await lookup("lan-box")).toEqual({ catalogIncomplete: true })
  expect(await lookup("gateway")).toEqual({ models: { m: {} }, catalogIncomplete: false })
  // An opted-in local LLM runtime is registered only when its reachability
  // probe succeeded; with no diagnostics, an absent one means "server down".
  expect(await lookup("ollama")).toEqual({ catalogIncomplete: true })
  expect(await lookup("unknown")).toBeUndefined()

  // The incomplete-catalog set is computed once per closure, not per lookup.
  expect(ready).toHaveBeenCalledTimes(1)
  expect(snapshot).toHaveBeenCalledTimes(1)
  expect(getProvider).toHaveBeenCalledTimes(4)
})

test("registryLookup keeps a never-enabled or disabled local runtime as not configured", async () => {
  vi.spyOn(Provider, "ready").mockResolvedValue(undefined)
  vi.spyOn(Provider, "snapshot").mockResolvedValue({
    discovery: { diagnostics: [] },
  } as unknown as Awaited<ReturnType<typeof Provider.snapshot>>)
  vi.spyOn(Provider, "getProvider").mockResolvedValue(undefined)

  // Never opted in: starting a local server would not register it.
  vi.spyOn(Config, "get").mockResolvedValue({} as unknown as Awaited<ReturnType<typeof Config.get>>)
  expect(await registryLookup()("ollama")).toBeUndefined()

  // Opted in through enabled_providers, but also disabled.
  vi.spyOn(Config, "get").mockResolvedValue({
    enabled_providers: ["ollama"],
    disabled_providers: ["ollama"],
  } as unknown as Awaited<ReturnType<typeof Config.get>>)
  expect(await registryLookup()("ollama")).toBeUndefined()

  // Opted in through enabled_providers and allowed.
  vi.spyOn(Config, "get").mockResolvedValue({
    enabled_providers: ["ollama"],
  } as unknown as Awaited<ReturnType<typeof Config.get>>)
  expect(await registryLookup()("ollama")).toEqual({ catalogIncomplete: true })

  // local-llm has no default host: enabled without a host it is never probed.
  vi.spyOn(Config, "get").mockResolvedValue({
    enabled_providers: ["local-llm"],
  } as unknown as Awaited<ReturnType<typeof Config.get>>)
  vi.stubEnv("LOCAL_LLM_HOST", "")
  expect(await registryLookup()("local-llm")).toBeUndefined()
  vi.unstubAllEnvs()
})
