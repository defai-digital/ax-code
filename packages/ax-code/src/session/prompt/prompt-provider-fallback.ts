import { Config } from "../../config/config"
import { RoutePolicy } from "../../provider/route-policy"
import { modelSelectableForProvider } from "../../provider/model-selectability"
import { Provider } from "../../provider/provider"
import { ModelID, ProviderID } from "../../provider/schema"

/**
 * Privacy guard: a session pinned to a local provider must never silently
 * migrate to a remote one. Users pick local inference precisely to keep
 * their prompts and code off third-party servers, so an automatic fallback
 * to a cloud provider would be a data leak.
 */
export const isLoopbackBaseURL = RoutePolicy.isLoopbackBaseURL
export function isLocalProvider(providerID: ProviderID) {
  return Provider.isLocalProvider(providerID)
}

export type FallbackOptions = {
  candidates?: readonly RoutePolicy.Target[]
  failedModelKeys?: Iterable<string>
}

/** Resolve only the next explicitly configured target, never a catalog substitute. */
export async function findFallbackModel(
  failedProviderID: ProviderID,
  preferredModelID?: ModelID,
  excludedProviderIDs: Iterable<ProviderID> = [],
  options: FallbackOptions = {},
): Promise<{ providerID: ProviderID; modelID: ModelID } | undefined> {
  const candidates = options.candidates ?? (await Config.get()).llm_routing?.fallback ?? []
  if (!candidates.length) return undefined
  const candidate = RoutePolicy.next({
    current: { providerID: failedProviderID, modelID: preferredModelID ?? "" },
    candidates,
    failed: options.failedModelKeys,
  })
  if (!candidate || new Set(excludedProviderIDs).has(ProviderID.make(candidate.providerID))) return undefined
  const target = { providerID: ProviderID.make(candidate.providerID), modelID: ModelID.make(candidate.modelID) }
  // A missing/unusable next target stops recovery; never skip to another one.
  const model = await Provider.getModel(target.providerID, target.modelID)
  if (!modelSelectableForProvider(target.providerID, model)) {
    throw new Error(`Configured fallback ${target.providerID}/${target.modelID} is not eligible for an agent request.`)
  }
  return target
}

export function chooseFallbackModel(
  providers: Awaited<ReturnType<typeof Provider.list>>,
  input: {
    failedProviderID: ProviderID
    preferredModelID?: ModelID
    excludedProviderIDs?: Iterable<ProviderID>
    candidates?: readonly RoutePolicy.Target[]
    failedModelKeys?: Iterable<string>
  },
): { providerID: ProviderID; modelID: ModelID } | undefined {
  const candidate = RoutePolicy.next({
    current: { providerID: input.failedProviderID, modelID: input.preferredModelID ?? "" },
    candidates: input.candidates ?? [],
    failed: input.failedModelKeys,
  })
  if (!candidate || new Set(input.excludedProviderIDs).has(ProviderID.make(candidate.providerID))) return undefined
  const model = providers[ProviderID.make(candidate.providerID)]?.models[ModelID.make(candidate.modelID)]
  if (!model) return undefined
  return { providerID: ProviderID.make(candidate.providerID), modelID: ModelID.make(candidate.modelID) }
}
