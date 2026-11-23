import { bootstrapReadonly } from "../../bootstrap"
import { cmd } from "../cmd"
import type { ProviderID } from "../../../provider/schema"

export type PinTarget = string | { providerID: string; modelID: string } | undefined

/** Typed outcome for one configured pin. Callers branch on `code`, never on `reason`. */
export type PinWarningCode =
  | "invalid_format"
  | "excluded"
  | "provider_not_configured"
  | "catalog_unavailable"
  | "model_not_found"

export type PinWarning = {
  pin: string
  target: string
  code: PinWarningCode
  /** Human-readable reason shown to the user. */
  reason: string
  /** Machine reason for an excluded pin (e.g. "configured-blacklist"); never prose. */
  excludeReason?: string
}

/**
 * One provider's catalog view. `status` separates "not configured" from
 * "catalog could not be fully loaded", and `exclusion` reports why a specific
 * model is not offered (config blacklist/whitelist or registry policy).
 * `undefined` is shorthand for `{ status: "missing" }` so simple fakes stay
 * terse.
 */
export type ProviderLookupResult = {
  status: "missing" | "ready" | "incomplete"
  models?: Record<string, unknown>
  exclusion?: (modelID: string) => string | undefined
}

export type ProviderLookup = (providerID: string) => Promise<ProviderLookupResult | undefined>

/** Structural subset of the config schema: every field that pins an exact provider/model. */
export type PinConfig = {
  model?: string
  small_model?: string
  wiki?: { model?: string }
  experimental?: { planner_architect_model?: string }
  agent?: Record<string, { model?: string; disable?: boolean } | undefined>
  llm_routing?: { fallback?: readonly { providerID: string; modelID: string }[] }
}

/**
 * Every config key that pins an exact provider/model, in a stable order. Unset
 * keys are omitted so callers can count configured pins. Shared by `ax-code
 * debug routing` and the doctor "Model pins" check so the two cannot drift.
 */
export function configuredPins(config: PinConfig): (readonly [string, PinTarget])[] {
  return [
    ...(config.model ? ([["model", config.model]] as const) : []),
    ...(config.small_model ? ([["small_model", config.small_model]] as const) : []),
    ...(config.wiki?.model ? ([["wiki.model", config.wiki.model]] as const) : []),
    ...(config.experimental?.planner_architect_model
      ? ([["experimental.planner_architect_model", config.experimental.planner_architect_model]] as const)
      : []),
    // A disabled agent is never loaded, so its model pin is never parsed or used.
    ...Object.entries(config.agent ?? {}).flatMap(([name, agent]) =>
      agent?.model && !agent.disable ? ([[`agent.${name}.model`, agent.model]] as const) : [],
    ),
    ...(config.llm_routing?.fallback ?? []).map((target, index) => [`llm_routing.fallback[${index}]`, target] as const),
  ]
}

/** Splits a string pin at the first "/", trimming both parts; throws when either is empty. */
function defaultParse(target: string): { providerID: string; modelID: string } {
  const separator = target.indexOf("/")
  const providerID = (separator >= 0 ? target.slice(0, separator) : "").trim()
  const modelID = (separator >= 0 ? target.slice(separator + 1) : "").trim()
  if (!providerID || !modelID) {
    throw new Error(`Invalid model format "${target}"; expected "provider/model"`)
  }
  return { providerID, modelID }
}

/** Maps a registry/config exclusion reason to the sentence shown to the user. */
function exclusionText(reason: string): string {
  switch (reason) {
    case "configured-blacklist":
      return "excluded by provider blacklist"
    case "outside-configured-whitelist":
      return "excluded by provider whitelist"
    case "deprecated-model":
      return "excluded: deprecated model"
    case "experimental-model-disabled":
      return "excluded: experimental models disabled"
    default:
      return "excluded by model policy"
  }
}

/**
 * Flag pins that do not resolve in the provider catalog. String pins are
 * parsed with `parse` (the runtime's `Provider.parseModel` in real callers),
 * so pins are judged the same way the runtime resolves them; a parse failure
 * is reported as "invalid model format" without consulting the catalog.
 * Exclusions are checked before "provider not configured" so a pin that is
 * explicitly blacklisted in config is reported as excluded even when its
 * provider is absent or its catalog is incomplete.
 */
export async function pinWarnings(
  pins: (readonly [string, PinTarget])[],
  lookup: ProviderLookup,
  parse: (target: string) => { providerID: string; modelID: string } = defaultParse,
): Promise<PinWarning[]> {
  const warnings: PinWarning[] = []
  for (const [pin, value] of pins) {
    if (!value) continue
    const target = typeof value === "string" ? value : `${value.providerID}/${value.modelID}`
    let resolved: { providerID: string; modelID: string }
    try {
      resolved =
        typeof value === "string"
          ? parse(value)
          : { providerID: value.providerID.trim(), modelID: value.modelID.trim() }
    } catch {
      warnings.push({ pin, target, code: "invalid_format", reason: "invalid model format" })
      continue
    }
    const provider = await lookup(resolved.providerID)
    const excluded = provider?.exclusion?.(resolved.modelID)
    if (excluded) {
      warnings.push({ pin, target, code: "excluded", reason: exclusionText(excluded), excludeReason: excluded })
      continue
    }
    if (!provider || provider.status === "missing") {
      warnings.push({ pin, target, code: "provider_not_configured", reason: "provider not configured" })
      continue
    }
    if (provider.models && Object.hasOwn(provider.models, resolved.modelID)) continue
    if (provider.status === "incomplete") {
      warnings.push({ pin, target, code: "catalog_unavailable", reason: "catalog unavailable" })
      continue
    }
    warnings.push({ pin, target, code: "model_not_found", reason: "model not in provider catalog" })
  }
  return warnings
}

/** Structural subset of the catalog-health view exposed by `Provider.catalogHealth()`. */
type CatalogHealthView = { all: boolean; failed: Set<string>; completed: Set<string> }

/** Shared by doctor and `debug routing` for any catalog_unavailable pin. */
export const CATALOG_UNAVAILABLE_ADVICE =
  "Some provider catalogs could not be loaded; check that those providers are running and returning a valid model list, then rerun."

/** Structural subset of a config provider block: only the model filters matter here. */
type ProviderFilterConfig = { blacklist?: readonly string[]; whitelist?: readonly string[] }

type RegistryContext = {
  health: CatalogHealthView
  exclusions: Map<string, Map<string, string>>
  config: {
    provider?: Record<string, ProviderFilterConfig | undefined>
    enabled_providers?: readonly string[]
    disabled_providers?: readonly string[]
  }
}

/** Mirrors the provider registry's opt-in and allow rules for local LLM runtimes. */
async function localRuntimeOptedIn(providerID: string): Promise<boolean> {
  const { Config } = await import("../../../config/config")
  const { Provider } = await import("../../../provider/provider")
  const config = await Config.get()
  const enabled = config.enabled_providers ? new Set<string>(config.enabled_providers) : null
  const disabled = new Set<string>(config.disabled_providers ?? [])
  if (!Provider.shouldAllowProviderInCore({ providerID, disabled, enabled })) return false
  const configured = Object.hasOwn(config.provider ?? {}, providerID) ? config.provider?.[providerID] : undefined
  if (!configured && !enabled?.has(providerID)) return false
  // A runtime without a default host is never probed unless a host is set.
  const { LOCAL_LLM_RUNTIMES } = await import("../../../provider/local-runtime")
  const runtime = LOCAL_LLM_RUNTIMES[providerID as keyof typeof LOCAL_LLM_RUNTIMES]
  return !!(runtime.defaultHost || process.env[runtime.envVar] || configured?.options?.baseURL)
}

/** Exclusions derived from a model row's status, which live discovery may override. */
const STATUS_EXCLUSIONS = new Set(["deprecated-model", "experimental-model-disabled"])

/**
 * Provider-catalog lookup backed by the live registry, shared by `debug
 * routing` and the doctor model pins check. Awaits discovery and memoizes the
 * catalog health, registry exclusions, and config once per closure. A provider
 * whose discovery failed is reported as `incomplete` (even when the failed
 * loader dropped it from the registry) instead of "not configured", because
 * the pin may work again once the endpoint is reachable; a whole-run
 * discovery failure only taints ids that were actually scheduled for
 * discovery and had not completed. A local LLM runtime that completed
 * discovery and was then dropped for an empty catalog is `ready` with an
 * empty model list, so its pins read as model_not_found; other providers can
 * complete with `{}` without contacting anything and stay `missing`. A provider that is absent and not
 * allowed by provider settings (enabled_providers / disabled_providers /
 * retired) is `missing` with no exclusion, since its config blacklist or
 * whitelist cannot explain a pin it cannot serve. Config
 * blacklist/whitelist exclusions are read directly from config, so they hold
 * even offline, when the provider is absent, or when its catalog is
 * incomplete; a whitelist miss counts only while the catalog cannot be
 * checked, but an explicit blacklist entry always holds. An opted-in, allowed
 * local LLM runtime absent from the registry without a recorded discovery
 * result gets the same `incomplete` treatment (for example when it was
 * dropped before discovery ran), so the pin works once the local server is
 * started. A runtime that was never opted in (config.provider /
 * enabled_providers) or is filtered out by provider settings stays "missing",
 * since starting a server would not help. Keeps this module free of static
 * provider imports — it is unit-tested with fakes via model-pins.ts.
 */
export function registryLookup(): ProviderLookup {
  let context: Promise<RegistryContext> | undefined
  const load = () =>
    (context ??= (async () => {
      const { Config } = await import("../../../config/config")
      const { Provider } = await import("../../../provider/provider")
      await Provider.ready()
      const [health, snapshot, config] = await Promise.all([
        Provider.catalogHealth(),
        Provider.snapshot(),
        Config.get(),
      ])
      const exclusions = new Map<string, Map<string, string>>()
      for (const entry of snapshot.exclusions) {
        const byModel = exclusions.get(entry.providerID) ?? new Map<string, string>()
        byModel.set(entry.modelID, entry.reason)
        exclusions.set(entry.providerID, byModel)
      }
      return { health, exclusions, config }
    })())
  return async (providerID) => {
    const { Provider } = await import("../../../provider/provider")
    const { LOCAL_LLM_RUNTIMES } = await import("../../../provider/local-runtime")
    const { health, exclusions, config } = await load()
    const configured = config.provider?.[providerID]
    const provider = await Provider.getProvider(providerID as ProviderID)
    // A provider filtered out by provider settings (enabled_providers /
    // disabled_providers / retired) cannot be registered, so its config
    // blacklist/whitelist must not explain a pin as "excluded".
    if (
      !provider &&
      !Provider.shouldAllowProviderInCore({
        providerID,
        disabled: new Set<string>(config.disabled_providers ?? []),
        enabled: config.enabled_providers ? new Set<string>(config.enabled_providers) : null,
        // ax-engine support is a host capability, not a config choice.
        axEngineSupported: true,
      })
    )
      return { status: "missing" }
    // An opted-in, allowed local LLM runtime that is absent and never
    // completed discovery failed its startup reachability probe (the server
    // is down); the pin is not stale. A runtime that completed discovery and
    // was dropped for an empty catalog has a verifiably complete, empty
    // catalog and is reported ready below.
    const runtimeDown =
      !provider &&
      !health.completed.has(providerID) &&
      Object.hasOwn(LOCAL_LLM_RUNTIMES, providerID) &&
      (await localRuntimeOptedIn(providerID))
    const incomplete = runtimeDown || (!health.completed.has(providerID) && health.failed.has(providerID))
    // With a complete catalog, a pin missing from both the catalog and the
    // recorded exclusions does not exist, so the config lists cannot explain it.
    const catalogVerifiable = !incomplete && (!!provider || health.completed.has(providerID))
    const exclusion = (modelID: string): string | undefined => {
      // Prefer the reason the registry recorded: it already follows
      // applyModelFilters' precedence for models that were actually loaded.
      const recorded = exclusions.get(providerID)?.get(modelID)
      // Saved fallback rows carry a status that live rows may not, so a status
      // exclusion is not trustworthy while the catalog is incomplete.
      if (recorded && !(incomplete && STATUS_EXCLUSIONS.has(recorded))) return recorded
      // An explicit blacklist entry names the model, so it explains the pin
      // even when a refresh rebuilt the catalog without it (for example an
      // AX Trust alias whose recorded reason was cleared).
      if (configured?.blacklist?.includes(modelID)) return "configured-blacklist"
      if (catalogVerifiable) return undefined
      // Absent provider or incomplete catalog: a whitelist miss still holds
      // offline and before a model loads.
      if (configured?.whitelist && !configured.whitelist.includes(modelID)) return "outside-configured-whitelist"
      return undefined
    }
    if (!provider) {
      // A local runtime that completed discovery and was then dropped for an
      // empty catalog (LM Studio/Ollama running with no model loaded) has a
      // verified, empty catalog: the pin is model_not_found, not
      // provider_not_configured. Other loaders can "complete" with `{}`
      // without contacting anything (missing token or CLI binary), so they
      // stay missing.
      if (health.completed.has(providerID) && Object.hasOwn(LOCAL_LLM_RUNTIMES, providerID))
        return { status: "ready", models: {}, exclusion }
      return { status: incomplete ? "incomplete" : "missing", exclusion }
    }
    return { status: incomplete ? "incomplete" : "ready", models: provider.models, exclusion }
  }
}

export const RoutingCommand = cmd({
  command: "routing",
  describe: "explain configured model selection and recovery without calling a model",
  builder: (yargs) => yargs.option("model", { type: "string", describe: "Exact primary provider/model to explain" }),
  async handler(args) {
    const { Config } = await import("../../../config/config")
    const { Provider } = await import("../../../provider/provider")
    const { RoutePolicy } = await import("../../../provider/route-policy")
    const { SessionRetry } = await import("../../../session/retry")
    await bootstrapReadonly(process.cwd(), async () => {
      const config = await Config.get()
      await Provider.ready()
      const primary = args.model ? Provider.parseModel(args.model) : await Provider.defaultModel()
      // An invalid `small_model` is already reported by `warnings` as
      // "invalid model format"; echoing the parse failure instead of throwing
      // keeps the rest of the routing preview printable.
      const auxiliary = config.small_model
        ? (() => {
            try {
              return Provider.parseModel(config.small_model)
            } catch {
              return { invalid: config.small_model }
            }
          })()
        : "inherit-primary"
      const fallback = (config.llm_routing?.fallback ?? []).filter(
        (target) => RoutePolicy.key(target) !== RoutePolicy.key(primary),
      )
      // The first entry reports the primary selection (--model override,
      // configured `model`, or most recent); configuredPins repeats the
      // `model` key in that case, so drop the duplicate from the shared list.
      const pins: (readonly [string, PinTarget])[] = [
        [args.model ? "--model" : config.model ? "model" : "recent", primary],
        ...configuredPins(config).filter(([pin]) => pin !== "model"),
      ]
      const warnings = await pinWarnings(pins, registryLookup(), (target) => Provider.parseModel(target))
      const registry = await Provider.snapshot()
      const notes = [
        "An unavailable configured fallback target stops request recovery.",
        "Unavailable auxiliary targets can fall back to the session model or skip optional work.",
        "Use exact provider/model IDs from ax-code models when updating pins.",
        "Auth, permanent quota, cancellation and output/tool replay constraints can stop the sequence early.",
        "Configuration loading and catalog discovery may contact providers without running inference.",
        "External CLI and gateway internal routing are outside this local preview.",
      ]
      if (warnings.some((warning) => warning.code === "catalog_unavailable")) notes.push(CATALOG_UNAVAILABLE_ADVICE)
      process.stdout.write(
        JSON.stringify(
          {
            primary,
            selectionSource: args.model ? "command" : config.model ? "config" : "recent",
            fallback,
            auxiliary,
            agentPins: Object.fromEntries(
              Object.entries(config.agent ?? {}).flatMap(([name, agent]) =>
                agent.model && !agent.disable ? [[name, agent.model]] : [],
              ),
            ),
            maxSameTargetRetries: SessionRetry.RETRY_MAX_ATTEMPTS,
            maxConcurrencyRetries: SessionRetry.CONCURRENCY_RETRY_MAX_ATTEMPTS,
            dispatch: false,
            availability: "not-probed",
            discovery: registry.discovery,
            excludedModels: registry.exclusions,
            warnings,
            notes,
          },
          null,
          2,
        ) + "\n",
      )
    })
  },
})
