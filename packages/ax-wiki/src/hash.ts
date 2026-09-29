import { createHash } from "node:crypto"

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex")
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

/**
 * Locale-independent string ordering (UTF-16 code units). `localeCompare`
 * delegates to ICU collation, which varies across hosts and ICU versions and
 * would make content-derived fingerprints environment-dependent.
 */
export function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareStableStrings(left, right))
      .map(([key, item]) => [key, sortValue(item)]),
  )
}
