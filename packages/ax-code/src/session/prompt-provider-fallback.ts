import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"

/**
 * Find a fallback model from a different provider when the current one fails.
 * Skips the failed provider and prefers the same model from another provider
 * before falling back to that provider's best available model.
 */
export async function findFallbackModel(
  failedProviderID: ProviderID,
  preferredModelID?: ModelID,
  excludedProviderIDs: Iterable<ProviderID> = [],
): Promise<{ providerID: ProviderID; modelID: ModelID } | undefined> {
  const providers = await Provider.list()
  return chooseFallbackModel(providers, { failedProviderID, preferredModelID, excludedProviderIDs })
}

export function chooseFallbackModel(
  providers: Awaited<ReturnType<typeof Provider.list>>,
  input: {
    failedProviderID: ProviderID
    preferredModelID?: ModelID
    excludedProviderIDs?: Iterable<ProviderID>
  },
): { providerID: ProviderID; modelID: ModelID } | undefined {
  const excluded = new Set<string>([input.failedProviderID, ...(input.excludedProviderIDs ?? [])])
  if (input.preferredModelID) {
    for (const [id, provider] of Object.entries(providers)) {
      if (excluded.has(id)) continue
      const preferred = provider.models[input.preferredModelID]
      if (preferred) {
        return { providerID: ProviderID.make(id), modelID: preferred.id }
      }
    }
  }

  for (const [id, provider] of Object.entries(providers)) {
    if (excluded.has(id)) continue
    const models = Provider.sort(Object.values(provider.models))
    if (models.length > 0) {
      return { providerID: ProviderID.make(id), modelID: models[0].id }
    }
  }
  return undefined
}
