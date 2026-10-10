// Shared helpers for the provider family modules (*-families.ts).

export function familyReleaseTime(value?: string): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

export function familyDisplayName(
  name: string | undefined,
  fallback: string,
  options?: { stripOpenRouterPrefix?: boolean },
): string {
  let trimmed = (name ?? fallback).replace(/\s*\(latest\)\s*/gi, " ")
  if (options?.stripOpenRouterPrefix) trimmed = trimmed.replace(/^openrouter:\s*/i, "")
  trimmed = trimmed.replace(/\s+/g, " ").trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function familySortKey(order: readonly string[], family?: string): number {
  const index = family === undefined ? -1 : order.indexOf(family)
  return index === -1 ? order.length : index
}

// Keep the newest model per family (by `compare`) and return them in `order`.
export function latestFamilyModels<T extends { id: string; family?: string }>(
  models: Record<string, T>,
  order: readonly string[],
  familyId: (input: { id: string; family?: string }) => string | undefined,
  compare: (a: T, b: T, aKey: string) => number,
): T[] {
  const best: Record<string, T | undefined> = {}
  for (const [id, model] of Object.entries(models)) {
    const family = familyId({ id: model.id ?? id, family: model.family })
    if (!family) continue
    const current = best[family]
    if (!current || compare(model, current, id) > 0) best[family] = model
  }
  return order.map((family) => best[family]).filter((model): model is T => model !== undefined)
}
