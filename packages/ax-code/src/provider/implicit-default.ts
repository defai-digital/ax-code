import { AX_ENGINE_PROVIDER_ID } from "./ax-engine/constants"
import { modelSelectableForProvider, skuKey } from "./model-selectability"

const FAMILY_DEFAULTS = {
  deepseek: { providerID: "deepseek", modelID: "deepseek-flash" },
  glm: { providerID: "zai", modelID: "glm-5.3-flash" },
  qwen: { providerID: "alibaba-token-plan", modelID: "qwen3.8-flash" },
} as const

/** Expand only unversioned family names; explicit model IDs stay verbatim. */
export function modelFamilyDefault(name: string) {
  const family = name.trim().toLowerCase()
  if (family === "deepseek" || family === "glm" || family === "qwen") return FAMILY_DEFAULTS[family]
  return undefined
}

/** Session default when the user does not pass --model / config.model. */
export const IMPLICIT_DEFAULT_MODEL_SKUS = [
  FAMILY_DEFAULTS.deepseek.modelID,
  FAMILY_DEFAULTS.glm.modelID,
  FAMILY_DEFAULTS.qwen.modelID,
  "MiniMax-M3",
  "grok-4.6",
  "claude-sonnet-5",
  "gpt-6",
  "gemini-3.8-flash",
  "qwen3.8-27b",
] as const

export const IMPLICIT_DEFAULT_UNAVAILABLE_MESSAGE =
  "No default model is available. Connect a provider that offers deepseek-flash, glm-5.3-flash, qwen3.8-flash, MiniMax-M3, grok-4.6, claude-sonnet-5, gpt-6, gemini-3.8-flash, or qwen3.8-27b, or pass --model provider/model. AX Engine requires an explicit model ID."

type SelectableProvider = {
  id: string
  models: Record<string, Parameters<typeof modelSelectableForProvider>[1]>
}

export function preferredDefaultSkuForProvider(providerID: string): string | undefined {
  if (providerID === AX_ENGINE_PROVIDER_ID) return undefined
  if (providerID === "deepseek" || providerID.startsWith("deepseek-")) return FAMILY_DEFAULTS.deepseek.modelID
  if (providerID.startsWith("zai") || providerID.startsWith("zhipuai")) return FAMILY_DEFAULTS.glm.modelID
  if (providerID === "alibaba-coding-plan" || providerID === "alibaba-coding-plan-cn") return "qwen3-coder-plus"
  if (providerID.startsWith("alibaba")) return FAMILY_DEFAULTS.qwen.modelID
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
  // Custom / AX Trust catalogs have no vendor SKU map. If DeepSeek Flash is
  // on the connected gateway, use it as that provider's default.
  const flash = findSelectableSku([{ id: providerID, models }], IMPLICIT_DEFAULT_MODEL_SKUS[0])
  if (flash) return flash.modelID
  return undefined
}
