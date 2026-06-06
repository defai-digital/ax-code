import type { ProviderListResponse } from "@ax-code/sdk/v2/client"

export interface ProviderModelPickItem {
  label: string
  description: string
}

export function providerModelPickItems(config: ProviderListResponse): ProviderModelPickItem[] {
  const items: ProviderModelPickItem[] = []
  for (const provider of config.all) {
    for (const modelID of Object.keys(provider.models ?? {})) {
      items.push({
        label: `${provider.id}/${modelID}`,
        description: provider.name ?? provider.id,
      })
    }
  }
  return items
}
