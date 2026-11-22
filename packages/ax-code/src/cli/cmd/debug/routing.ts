import { bootstrapReadonly } from "../../bootstrap"
import { cmd } from "../cmd"
import type { ProviderID } from "../../../provider/schema"

export type PinTarget = string | { providerID: string; modelID: string } | undefined

/**
 * Resolves a provider to its local catalog view. The lookup may wait for
 * provider catalog discovery, which can contact providers; it never runs
 * inference. `models` is omitted and `catalogIncomplete` set when the
 * provider's catalog could not be fully loaded (discovery failure or
 * timeout), so callers can distinguish "stale pin" from "catalog unknown".
 */
export type ProviderLookup = (
  providerID: string,
) => Promise<{ models?: Record<string, unknown>; catalogIncomplete?: boolean } | undefined>

/** Structural subset of the config schema: every field that pins an exact provider/model. */
export type PinConfig = {
  model?: string
  small_model?: string
  wiki?: { model?: string }
  experimental?: { planner_architect_model?: string }
  agent?: Record<string, { model?: string } | undefined>
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
    ...Object.entries(config.agent ?? {}).flatMap(([name, agent]) =>
      agent?.model ? ([[`agent.${name}.model`, agent.model]] as const) : [],
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

/**
 * Flag pins that do not resolve in the provider catalog. String pins are
 * parsed with `parse` (the runtime's `Provider.parseModel` in real callers),
 * so pins are judged the same way the runtime resolves them; a parse failure
 * is reported as "invalid model format" without consulting the catalog.
 */
export async function pinWarnings(
  pins: (readonly [string, PinTarget])[],
  lookup: ProviderLookup,
  parse: (target: string) => { providerID: string; modelID: string } = defaultParse,
) {
  const warnings: { pin: string; target: string; reason: string }[] = []
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
      warnings.push({ pin, target, reason: "invalid model format" })
      continue
    }
    const provider = await lookup(resolved.providerID)
    if (!provider) warnings.push({ pin, target, reason: "provider not configured" })
    else if (provider.models && Object.hasOwn(provider.models, resolved.modelID)) continue
    else if (provider.catalogIncomplete) warnings.push({ pin, target, reason: "catalog unavailable" })
    else warnings.push({ pin, target, reason: "model not in provider catalog" })
  }
  return warnings
}

/**
 * Parse provider discovery diagnostics into which catalogs could not be
 * loaded: `all` when the whole discovery run failed, otherwise the provider
 * ids whose loader, discovery, or plugin auth failed. Unknown source
 * prefixes are ignored.
 */
export function incompleteCatalogs(diagnostics: readonly { source: string }[]): {
  all: boolean
  providers: Set<string>
} {
  const providers = new Set<string>()
  let all = false
  for (const diagnostic of diagnostics) {
    if (diagnostic.source === "discovery") {
      all = true
      continue
    }
    const match = diagnostic.source.match(/^(?:discovery|loader|plugin-auth):(.+)$/)
    if (match?.[1]) providers.add(match[1])
  }
  return { all, providers }
}

/**
 * Provider-catalog lookup backed by the live registry, shared by `debug
 * routing` and the doctor model pins check. Awaits discovery and computes
 * the incomplete-catalog set once per closure; a provider whose discovery
 * failed is reported as `catalogIncomplete` (even when the failed loader
 * dropped it from the registry) instead of "not configured", because the pin
 * may work again once the endpoint is reachable. An opted-in, allowed local
 * LLM runtime absent from the registry gets the same treatment: such runtimes
 * register only when their startup reachability probe succeeds, so the pin
 * works once the local server is started. A runtime that was never opted in
 * (config.provider / enabled_providers) or is filtered out by provider
 * settings stays "not configured", since starting a server would not help.
 * Keeps this module free of static provider imports — it is unit-tested with
 * fakes via model-pins.ts.
 */
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

export function registryLookup(): ProviderLookup {
  let incomplete: Promise<{ all: boolean; providers: Set<string> }> | undefined
  return async (providerID) => {
    const { Provider } = await import("../../../provider/provider")
    const { LOCAL_LLM_RUNTIMES } = await import("../../../provider/local-runtime")
    incomplete ??= (async () => {
      await Provider.ready()
      return incompleteCatalogs((await Provider.snapshot()).discovery.diagnostics)
    })()
    const state = await incomplete
    const catalogIncomplete = state.all || state.providers.has(providerID)
    const provider = await Provider.getProvider(providerID as ProviderID)
    if (!provider) {
      if (catalogIncomplete) return { catalogIncomplete: true }
      // An opted-in, allowed local LLM runtime that is absent failed its
      // startup reachability probe (the server is down); the pin is not stale.
      if (Object.hasOwn(LOCAL_LLM_RUNTIMES, providerID) && (await localRuntimeOptedIn(providerID)))
        return { catalogIncomplete: true }
      return undefined
    }
    return { models: provider.models, catalogIncomplete }
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
      if (warnings.some((warning) => warning.reason === "catalog unavailable"))
        notes.push("Some provider catalogs could not be loaded; rerun when those providers are reachable.")
      process.stdout.write(
        JSON.stringify(
          {
            primary,
            selectionSource: args.model ? "command" : config.model ? "config" : "recent",
            fallback,
            auxiliary,
            agentPins: Object.fromEntries(
              Object.entries(config.agent ?? {}).flatMap(([name, agent]) => (agent.model ? [[name, agent.model]] : [])),
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
