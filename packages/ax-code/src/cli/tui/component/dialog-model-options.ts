import { modelSelectableForProvider } from "@/provider/model-selectability"

type DialogModelOptionInfo = {
  id?: string
  tool_call?: boolean
  capabilities?: {
    toolcall?: boolean
    output?: { text?: boolean }
  }
  options?: { minMemoryBytes?: unknown }
}

export function dialogModelOptionDisabled(
  providerID: string,
  modelID: string,
  model: DialogModelOptionInfo | undefined,
) {
  if (!modelSelectableForProvider(providerID, model)) return true
  return providerID === "opencode" && modelID.includes("-nano")
}

/**
 * Model-picker sections are one per provider. Family (Opus/Sonnet/…) is a sort
 * key, not a heading — repeating "Anthropic (Claude Code) · Opus" above
 * "Claude Opus 5" wasted a row per family. A picker already scoped to one
 * provider omits the heading; the dialog title names it.
 */
export function dialogModelPickerCategory(input: {
  providerName: string
  connected?: boolean
  scopedToProvider?: boolean
}): string | undefined {
  if (!input.connected || input.scopedToProvider) return undefined
  return input.providerName
}

export function dialogModelMatches(
  left: { providerID: string; modelID: string },
  right: { providerID: string; modelID: string },
) {
  return left.providerID === right.providerID && left.modelID === right.modelID
}

/** Recent and Favorites are jump lists. The provider group stays a full catalog. */
export function dialogModelInShortcutList(
  list: readonly { providerID: string; modelID: string }[],
  model: { providerID: string; modelID: string },
) {
  return list.some((item) => dialogModelMatches(item, model))
}

export function dialogModelCatalogDescription(input: {
  blockReason?: string
  favorite?: boolean
  recent?: boolean
}): string | undefined {
  if (input.blockReason) return input.blockReason
  if (input.favorite) return "(Favorite)"
  if (input.recent) return "(Recent)"
  return undefined
}
