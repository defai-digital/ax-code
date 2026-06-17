import type { ProviderListResponse } from "@ax-code/sdk/v2/client"

export interface ProviderModelPickItem {
  label: string
  description: string
}

export function providerModelPickItems(config: ProviderListResponse): ProviderModelPickItem[] {
  // Only surface models from connected/authenticated providers. `config.all`
  // is the full catalog (available + connected); selecting a model from a
  // disconnected provider would fail or demand auth after the fact. See #265.
  const connected = new Set(config.connected ?? [])
  const items: ProviderModelPickItem[] = []
  for (const provider of config.all) {
    if (!connected.has(provider.id)) continue
    for (const modelID of Object.keys(provider.models ?? {})) {
      items.push({
        label: `${provider.id}/${modelID}`,
        description: provider.name ?? provider.id,
      })
    }
  }
  return items
}
