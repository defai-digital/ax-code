/**
 * Normalize provider model IDs for fuzzy capability matching.
 * Provider catalogs spell the same model with different separators/casing.
 */
export function normalizeProviderModelId(modelId: string): string {
  return modelId.toLowerCase().replace(/[._-]/g, "")
}

/**
 * Last non-empty path segment of a model id (e.g. `x-ai/grok-4.5` → `grok-4.5`).
 * Used for family/allow-list matching so reseller prefixes do not confuse probes.
 */
export function modelIdFinalSegment(modelId: string): string {
  return modelId.split("/").filter(Boolean).at(-1) ?? ""
}
