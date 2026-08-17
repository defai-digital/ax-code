// Provider IDs AX Code no longer supports. Keep this list shared between the
// runtime and snapshot regeneration so stale local data or an upstream catalog
// refresh cannot resurrect a removed provider.
export const RETIRED_PROVIDER_IDS = ["gemini-cli", "antigravity-cli", "xai"] as const

const RETIRED_PROVIDER_ID_SET = new Set<string>(RETIRED_PROVIDER_IDS)

export function isRetiredProviderID(providerID: string): boolean {
  return RETIRED_PROVIDER_ID_SET.has(providerID)
}
