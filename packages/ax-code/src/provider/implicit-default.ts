import { AX_ENGINE_PROVIDER_ID } from "./ax-engine/constants"
import { modelSelectableForProvider, skuKey } from "./model-selectability"

/** Session default when the user does not pass --model / config.model. */
export const IMPLICIT_DEFAULT_MODEL_SKUS = [
  "deepseek-flash",
  "MiniMax-M3",
  "glm-5.3-flash",
  "qwen3.8-flash",
  "muse-spark-1.3",
] as const

export const IMPLICIT_DEFAULT_UNAVAILABLE_MESSAGE =
  "No default model is available. Connect DeepSeek (deepseek-flash), MiniMax Token Plan (MiniMax-M3), Z.AI (glm-5.3-flash), Alibaba Token Plan (qwen3.8-flash), or Meta (muse-spark-1.3), or pass --model provider/model. AX Engine requires an explicit model ID."

type SelectableProvider = {
  id: string
  models: Record<string, Parameters<typeof modelSelectableForProvider>[1]>
}

export function preferredDefaultSkuForProvider(providerID: string): string | undefined {
  if (providerID === AX_ENGINE_PROVIDER_ID) return undefined
  if (providerID === "deepseek" || providerID.startsWith("deepseek-")) return "deepseek-flash"
  if (providerID.startsWith("zai") || providerID.startsWith("zhipuai")) return "glm-5.3-flash"
  if (providerID === "alibaba-coding-plan" || providerID === "alibaba-coding-plan-cn") return "qwen3-coder-plus"
  if (providerID.startsWith("alibaba")) return "qwen3.8-flash"
  if (providerID.startsWith("minimax")) return "MiniMax-M3"
  if (providerID === "meta") return "muse-spark-1.3"
  if (providerID === "google" || providerID === "google-vertex") return "gemini-3.8-flash"
  if (providerID === "groq") return "openai/gpt-oss-20b"
  return undefined
}

export function findSelectableSku(
  providers: readonly SelectableProvider[],
  sku: string,
): { providerID: string; modelID: string } | undefined {
  const needle = skuKey(sku)
  if (!needle) return undefined
  for (const provider of providers) {
    if (provider.id === AX_ENGINE_PROVIDER_ID) continue
    const hit = Object.keys(provider.models)
      .filter((id) => skuKey(id) === needle && modelSelectableForProvider(provider.id, provider.models[id]))
      .sort((left, right) => left.length - right.length || left.localeCompare(right))[0]
    if (hit) return { providerID: provider.id, modelID: hit }
  }
  return undefined
}

export function pickImplicitDefaultModel(
  providers: readonly SelectableProvider[],
): { providerID: string; modelID: string } | undefined {
  for (const sku of IMPLICIT_DEFAULT_MODEL_SKUS) {
    const hit = findSelectableSku(providers, sku)
    if (hit) return hit
  }
  return undefined
}

export function defaultModelIDForProvider(
  providerID: string,
  models: Record<string, Parameters<typeof modelSelectableForProvider>[1]>,
): string | undefined {
  if (providerID === AX_ENGINE_PROVIDER_ID) return undefined
  const preferred = preferredDefaultSkuForProvider(providerID)
  if (preferred) {
    const hit = findSelectableSku([{ id: providerID, models }], preferred)
    if (hit) return hit.modelID
  }
  return undefined
}
