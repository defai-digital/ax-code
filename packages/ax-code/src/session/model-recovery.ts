import { Config } from "../config/config"
import { RoutePolicy } from "../provider/route-policy"
import { modelSelectableForProvider } from "../provider/model-selectability"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"

export type FallbackOptions = {
  candidates?: readonly RoutePolicy.Target[]
  failedModelKeys?: Iterable<string>
}

type ResolvedFallback = {
  target: { providerID: ProviderID; modelID: ModelID }
  model: Provider.Model
}

/** Keep the endpoint used by the request in scope if the provider registry has changed. */
export async function isLocalRecoveryProvider(providerID: ProviderID, endpoint?: string): Promise<boolean> {
  return RoutePolicy.hasLocalEndpoint({ api: endpoint }) || Provider.isLocalProvider(providerID)
}

/** Resolve the next configured target in owner order. Invalid targets stop recovery. */
export async function resolveFallbackModel(
  current: RoutePolicy.Target,
  options: FallbackOptions = {},
): Promise<ResolvedFallback | undefined> {
  const candidates = options.candidates ?? (await Config.get()).llm_routing?.fallback ?? []
  if (!candidates.length) return undefined
  const candidate = RoutePolicy.next({ current, candidates, failed: options.failedModelKeys })
  if (!candidate) return undefined

  const target = { providerID: ProviderID.make(candidate.providerID), modelID: ModelID.make(candidate.modelID) }
  const model = await Provider.getModel(target.providerID, target.modelID)
  if (!modelSelectableForProvider(target.providerID, model)) {
    throw new Error(`Configured fallback ${target.providerID}/${target.modelID} is not eligible for an agent request.`)
  }
  return { target, model }
}
