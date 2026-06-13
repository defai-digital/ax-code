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
): Promise<{ providerID: ProviderID; modelID: ModelID } | undefined> {
  const providers = await Provider.list()
  return chooseFallbackModel(providers, { failedProviderID, preferredModelID })
}

export function chooseFallbackModel(
  providers: Awaited<ReturnType<typeof Provider.list>>,
  input: {
    failedProviderID: ProviderID
    preferredModelID?: ModelID
  },
): { providerID: ProviderID; modelID: ModelID } | undefined {
  if (input.preferredModelID) {
    for (const [id, provider] of Object.entries(providers)) {
      if (id === input.failedProviderID) continue
      const preferred = provider.models[input.preferredModelID]
      if (preferred) {
        return { providerID: ProviderID.make(id), modelID: preferred.id }
      }
    }
  }

  for (const [id, provider] of Object.entries(providers)) {
    if (id === input.failedProviderID) continue
    const models = Provider.sort(Object.values(provider.models))
    if (models.length > 0) {
      return { providerID: ProviderID.make(id), modelID: models[0].id }
    }
  }
  return undefined
}
