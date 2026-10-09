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
