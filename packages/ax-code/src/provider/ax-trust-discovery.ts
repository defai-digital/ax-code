import { CustomApiProvider } from "./custom-api-provider"
import type { ProviderInfo, ProviderModel } from "./model-info"
import { declaredCapabilityEvidence, withCapabilityEvidence } from "./capability-evidence"
import { ModelID } from "./schema"
import { ModelsDev } from "./models"
import { exactCatalogFallbackModels } from "./ax-trust-catalog"

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
  const saved = new Map(Object.entries(provider.models))
  const firstAliasByTarget = new Map<string, ProviderModel>()
  for (const [localKey, model] of saved) {
    if (localKey !== model.api.id && !firstAliasByTarget.has(model.api.id)) {
      firstAliasByTarget.set(model.api.id, model)
    }
  }
  const canonical = new Map(
    models.map((model) => {
      const previous = saved.get(model.id) ?? firstAliasByTarget.get(model.id)
      const fallback = fallbackModels[model.id]
      const next: ProviderModel = {
        id: ModelID.make(model.id),
        providerID: provider.id,
        name: model.name ?? model.id,
        api: { id: model.id, url: connection.baseURL, npm: connection.npm },
        capabilities: withCapabilityEvidence(
          {
            temperature: model.temperature,
            reasoning: model.reasoning,
            attachment: model.attachment,
            toolcall: model.toolCall,
            // `pdf` is the gateway's statement that the route can carry a
            // document (AX Trust ADR-115); an undeclared card keeps the text
            // fallback in the read tool.
            input: { text: true, image: model.attachment, audio: false, video: false, pdf: model.pdf ?? false },
            output: { text: true, image: false, audio: false, video: false, pdf: false },
            interleaved: fallback?.interleaved ?? previous?.capabilities.interleaved ?? false,
            // Discovery resolves the gateway's declared search flag (or leaves it
            // undefined when the card said nothing); carry it through verbatim.
            websearch: model.websearch,
          },
          {},
          "deployment",
          declaredCapabilityEvidence(model),
        ),
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
  // Resolve every saved alias against the gateway rows. A local alias can
  // occupy the same key as a gateway row without changing other aliases.
  const discovered = new Map(canonical)
  for (const [localKey, previous] of saved) {
    const remoteId = previous.api.id
    if (localKey === remoteId) continue
    const target = canonical.get(remoteId)
    if (!target) continue
    discovered.set(localKey, {
      ...target,
      id: ModelID.make(localKey),
      name: previous.name || target.name,
      options: previous.options ?? target.options,
      headers: previous.headers ?? target.headers,
    })
  }
  return Object.fromEntries(discovered)
}
