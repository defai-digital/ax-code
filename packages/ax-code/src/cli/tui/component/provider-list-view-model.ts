import { isRetiredProviderID } from "@/provider/retired-providers"

// Shared derivation of config-disabled provider IDs that are still relevant to
// surface. Retired IDs are dropped (stale local data must not keep a provider
// alive), and IDs already present in the connected list are dropped so a
// provider is never double-counted as disabled during the window between a
// config update and the provider list refetch.
export function disabledProviderIDs(
  config: { disabled_providers?: string[] } | undefined,
  connectedProviderIDs: readonly string[],
): string[] {
  const connected = new Set(connectedProviderIDs)
  return (config?.disabled_providers ?? []).filter((id) => !isRetiredProviderID(id) && !connected.has(id))
}
