import os from "os"
import { CLI_PROVIDER_IDS } from "./cli/ids"
import { modelIdFinalSegment, normalizeProviderModelId } from "./model-id"

// Providers allowed to surface models that don't advertise tool calling. For
// most providers a non-toolcall model is hidden from the picker because the
// agent needs tools, but these CLI providers serve models a user may
// legitimately want anyway.
const TOOLCALL_OPTIONAL_PROVIDER_IDS = new Set<string>(CLI_PROVIDER_IDS)

type SelectableModel = {
  tool_call?: boolean
  capabilities?: {
    toolcall?: boolean
    output?: { text?: boolean }
  }
  options?: { minMemoryBytes?: unknown }
}

export function modelMemoryBlockReason(
  providerID: string,
  model: { options?: { minMemoryBytes?: unknown } } | undefined,
  memoryBytes: number = os.totalmem(),
) {
  if (providerID !== "ax-engine") return undefined
  const minMemoryBytes = model?.options?.minMemoryBytes
  if (typeof minMemoryBytes !== "number" || minMemoryBytes <= 0) return undefined
  if (memoryBytes >= minMemoryBytes) return undefined
  return `requires ${Math.ceil(minMemoryBytes / 1024 ** 3)}GB unified memory`
}

export function providerModelSelectable(input: { providerID: string; toolcall?: boolean }) {
  if (input.toolcall !== false) return true
  return TOOLCALL_OPTIONAL_PROVIDER_IDS.has(input.providerID)
}

// Model IDs that name a non-chat modality. OpenAI-compatible gateways list
// these next to chat models on GET /models, and they must never be offered
// as an agent lane or picked as the auxiliary (title/summary) model.
const NON_CHAT_ID_TOKENS = [
  "embed",
  "rerank",
  "whisper",
  "transcribe",
  "tts",
  "moderation",
  "dall-e",
  "gpt-image",
  "realtime",
]

export function isNonChatModelID(modelID: string) {
  const id = modelID.toLowerCase()
  return NON_CHAT_ID_TOKENS.some((token) => id.includes(token))
}

// Catalog identity of a model ID: final path segment, "[Nm]" context suffix
// removed, separators normalized — `deepseek/deepseek-v4-pro`,
// `DeepSeek-V4-Pro`, and `deepseek-v4-pro[1m]` all share one key.
export function skuKey(modelID: string) {
  return normalizeProviderModelId(modelIdFinalSegment(modelID).replace(/\[\d+[mM]\]$/, ""))
}

/**
 * The same model on another connected provider: exact model ID first, then
 * the same SKU under a reseller prefix or a "[1m]" suffix, which is how
 * gateways commonly relabel a native ID. Used to follow a pin whose provider
 * was disabled after the model moved behind a custom gateway.
 */
export function sameSkuOnConnectedProvider(
  providers: readonly { id: string; models: Record<string, SelectableModel | undefined> }[],
  model: { providerID: string; modelID: string },
): { providerID: string; modelID: string } | undefined {
  const candidates = providers.filter((provider) => provider.id !== model.providerID)
  for (const provider of candidates) {
    if (modelSelectableForProvider(provider.id, provider.models[model.modelID]))
      return { providerID: provider.id, modelID: model.modelID }
  }
  const needle = skuKey(model.modelID)
  if (!needle) return undefined
  for (const provider of candidates) {
    const hit = Object.keys(provider.models)
      .filter((id) => skuKey(id) === needle && modelSelectableForProvider(provider.id, provider.models[id]))
      .sort((left, right) => left.length - right.length || left.localeCompare(right))[0]
    if (hit) return { providerID: provider.id, modelID: hit }
  }
  return undefined
}

export function modelSelectableForProvider(providerID: string, model: SelectableModel | undefined) {
  if (!model) return false
  if (modelMemoryBlockReason(providerID, model)) return false
  // AX Code's agent loop requires a textual assistant response. Models that
  // explicitly advertise image-only (or other non-text) output cannot produce
  // a usable coding turn, even when they accept tool schemas.
  if (model.capabilities?.output?.text === false) return false
  return providerModelSelectable({
    providerID,
    toolcall: model.capabilities?.toolcall ?? model.tool_call,
  })
}
