import { bootstrapReadonly } from "../../bootstrap"
import { cmd } from "../cmd"
import type { ProviderID } from "../../../provider/schema"

export type PinTarget = string | { providerID: string; modelID: string } | undefined

/** Resolves a provider to its local catalog view; never sends model requests. */
export type ProviderLookup = (providerID: string) => Promise<{ models: Record<string, unknown> } | undefined>

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

/**
 * A pin naming a provider or model that is not configured fails at dispatch.
 * Flag it from local provider state; nothing is probed.
 */
export async function pinWarnings(
  pins: (readonly [string, PinTarget])[],
  lookup: (providerID: string) => Promise<{ models: Record<string, unknown> } | undefined>,
) {
  const warnings: { pin: string; target: string; reason: string }[] = []
  for (const [pin, value] of pins) {
    if (!value) continue
    const target = typeof value === "string" ? value : `${value.providerID}/${value.modelID}`
    const separator = target.indexOf("/")
    const providerID = target.slice(0, separator)
    const modelID = target.slice(separator + 1)
    const provider = separator > 0 ? await lookup(providerID) : undefined
    if (!provider) warnings.push({ pin, target, reason: "provider not configured" })
    else if (!Object.hasOwn(provider.models, modelID))
      warnings.push({ pin, target, reason: "model not in provider catalog" })
  }
  return warnings
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
      const primary = args.model ? Provider.parseModel(args.model) : await Provider.defaultModel()
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
      const warnings = await pinWarnings(pins, async (providerID) => {
        const provider = await Provider.getProvider(providerID as ProviderID)
        return provider && { models: provider.models }
      })
      const registry = await Provider.snapshot()
      process.stdout.write(
        JSON.stringify(
          {
            primary,
            selectionSource: args.model ? "command" : config.model ? "config" : "recent",
            fallback,
            auxiliary: config.small_model ? Provider.parseModel(config.small_model) : "inherit-primary",
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
            notes: [
              "Only configured targets may be used; an unavailable next target stops recovery.",
              "Auth, permanent quota, cancellation and output/tool replay constraints can stop the sequence early.",
              "Configuration loading may fetch configured remote settings; no model requests are sent.",
              "External CLI and gateway internal routing are outside this local preview.",
            ],
          },
          null,
          2,
        ) + "\n",
      )
    })
  },
})
