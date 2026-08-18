import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { AX_ENGINE_PROVIDER_ID } from "../provider/ax-engine/constants"

/**
 * Privacy guard: a session pinned to a local provider must never silently
 * migrate to a remote one. Users pick local inference precisely to keep
 * their prompts and code off third-party servers, so an automatic fallback
 * to a cloud provider would be a data leak.
 */
export function isLoopbackBaseURL(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "")
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")
  } catch {
    return false
  }
}

/**
 * Best-effort locality check. ax-engine is always local; any other provider
 * whose configured baseURL (or catalog api URL) points at a loopback address
 * (user-configured Ollama/LM Studio etc.) is treated as local too.
 */
export async function isLocalProvider(providerID: ProviderID): Promise<boolean> {
  if (providerID === AX_ENGINE_PROVIDER_ID) return true
  const providers = await Provider.list().catch(() => undefined)
  const info = providers?.[providerID]
  if (!info) return false
  if (isLoopbackBaseURL(info.options?.["baseURL"])) return true
  const firstModel = Object.values(info.models)[0]
  return isLoopbackBaseURL(firstModel?.api?.url)
}

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
