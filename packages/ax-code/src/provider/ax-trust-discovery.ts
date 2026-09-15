import { CustomApiProvider } from "./custom-api-provider"
import type { ProviderInfo, ProviderModel } from "./model-info"
import { ModelID } from "./schema"
import { ModelsDev } from "./models"

// First-party vendors whose exact model IDs AX Trust resells. Sparse gateway
// cards inherit family / interleaved / reasoning from these catalogs only.
// Do not scan reseller catalogs: those cards disagree on windows and
// interleaved. Do not match family or prefix: a gateway alias may target a
// different model (`my-glm-5.3` is not `glm-5.3`).
const FIRST_PARTY_CATALOG_IDS = ["deepseek", "zhipuai", "zai", "minimax", "moonshotai", "moonshot", "alibaba"] as const

export function exactCatalogFallbackModels(
  catalog: Record<string, { models?: Record<string, ModelsDev.Model> }>,
): Record<string, ModelsDev.Model> {
  const out: Record<string, ModelsDev.Model> = {}
  for (const providerID of FIRST_PARTY_CATALOG_IDS) {
    const models = catalog[providerID]?.models
    if (!models) continue
    for (const [id, model] of Object.entries(models)) {
      if (out[id]) continue
      out[id] = model
    }
  }
  return out
}

function previousAxTrustModel(provider: ProviderInfo, remoteId: string) {
  const direct = provider.models[remoteId]
  if (direct) return { key: remoteId, model: direct }
  const aliased = Object.entries(provider.models).find(([, model]) => model.api.id === remoteId)
  if (!aliased) return undefined
  return { key: aliased[0], model: aliased[1] }
}

// AX Trust advertises attachment as image support in its /models contract.
// Keep execution options local; remote model cards only supply metadata.
export async function discoverAxTrustModels(
  provider: ProviderInfo,
  connection: { baseURL: string; apiKey: string; npm: string },
): Promise<Record<string, ProviderModel>> {
  const fallbackModels = exactCatalogFallbackModels(await ModelsDev.get())
  const models = await CustomApiProvider.discoverModels({ ...connection, requireComplete: true, fallbackModels })
  const discovered = Object.fromEntries(
    models.map((model) => {
      const previous = previousAxTrustModel(provider, model.id)?.model
      const fallback = fallbackModels[model.id]
      const next: ProviderModel = {
        id: ModelID.make(model.id),
        providerID: provider.id,
        name: model.name ?? model.id,
        api: { id: model.id, url: connection.baseURL, npm: connection.npm },
        capabilities: {
          temperature: model.temperature,
          reasoning: model.reasoning,
          attachment: model.attachment,
          toolcall: model.toolCall,
          input: { text: true, image: model.attachment, audio: false, video: false, pdf: false },
          output: { text: true, image: false, audio: false, video: false, pdf: false },
          interleaved: fallback?.interleaved ?? previous?.capabilities.interleaved ?? false,
        },
        limit: { context: model.contextWindow, output: model.outputLimit },
        status: "active",
        options: previous?.options ?? {},
        headers: previous?.headers ?? {},
        family: fallback?.family ?? previous?.family ?? "",
        release_date: fallback?.release_date ?? previous?.release_date ?? "",
        variants: {},
      }
      return [model.id, next]
    }),
  )
  for (const [localKey, previous] of Object.entries(provider.models)) {
    const remoteId = previous.api.id
    if (localKey === remoteId) continue
    const canonical = discovered[remoteId]
    if (!canonical) continue
    discovered[localKey] = {
      ...canonical,
      id: ModelID.make(localKey),
      name: previous.name || canonical.name,
      options: previous.options ?? canonical.options,
      headers: previous.headers ?? canonical.headers,
    }
  }
  return discovered
}
