/**
 * Normalize provider model IDs for fuzzy capability matching.
 * Provider catalogs spell the same model with different separators/casing.
 */
export function normalizeProviderModelId(modelId: string): string {
  return modelId.toLowerCase().replace(/[._-]/g, "")
}
