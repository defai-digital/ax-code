import { CustomApiProvider } from "./custom-api-provider"
import type { ProviderInfo, ProviderModel } from "./model-info"
import { ModelID } from "./schema"
import { ModelsDev } from "./models"
import { exactCatalogFallbackModels } from "./ax-trust-catalog"

// The fallback table and its first-party catalog list live in
// ./ax-trust-catalog so the editor's connect/refresh path
// (CustomApiProvider.upsert) can share them without an import cycle.
export { exactCatalogFallbackModels, FIRST_PARTY_CATALOG_IDS } from "./ax-trust-catalog"

function previousAxTrustModel(provider: ProviderInfo, remoteId: string) {
  const direct = provider.models[remoteId]
  if (direct) return { key: remoteId, model: direct }
  const aliased = Object.entries(provider.models).find(([, model]) => model.api.id === remoteId)
  if (!aliased) return undefined
  return { key: aliased[0], model: aliased[1] }
}

// AX Trust model cards declare image support through `vision`, the input
// modality list, or the generic `attachment` flag, in that order; discoveredModel
// resolves that order into the single image/attachment value mapped below.
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
          // Discovery resolves the gateway's declared search flag (or leaves it
          // undefined when the card said nothing); carry it through verbatim.
          websearch: model.websearch,
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
