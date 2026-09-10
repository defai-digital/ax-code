import { CustomApiProvider } from "./custom-api-provider"
import type { ProviderInfo, ProviderModel } from "./model-info"
import { ModelID } from "./schema"
import { ModelsDev } from "./models"

// AX Trust advertises attachment as image support in its /models contract.
// Keep execution options local; remote model cards only supply metadata.
export async function discoverAxTrustModels(
  provider: ProviderInfo,
  connection: { baseURL: string; apiKey: string; npm: string },
): Promise<Record<string, ProviderModel>> {
  // Exact first-party DeepSeek IDs can fill sparse gateway cards. Do not use
  // family/prefix matching: a gateway alias may target a different model.
  const fallbackModels = (await ModelsDev.get()).deepseek?.models
  const models = await CustomApiProvider.discoverModels({ ...connection, requireComplete: true, fallbackModels })
  return Object.fromEntries(
    models.map((model) => {
      const previous = provider.models[model.id]
      const fallback = fallbackModels?.[model.id]
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
}
