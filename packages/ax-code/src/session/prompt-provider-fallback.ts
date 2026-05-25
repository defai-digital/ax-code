import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"

/**
 * Find a fallback model from a different provider when the current one fails.
 * Skips the failed provider and returns the best model from the next available one.
 */
export async function findFallbackModel(
  failedProviderID: ProviderID,
): Promise<{ providerID: ProviderID; modelID: ModelID } | undefined> {
  const providers = await Provider.list()
  for (const [id, provider] of Object.entries(providers)) {
    if (id === failedProviderID) continue
    const models = Provider.sort(Object.values(provider.models))
    if (models.length > 0) {
      return { providerID: ProviderID.make(id), modelID: models[0].id }
    }
  }
  return undefined
}
