/**
 * SDK version and compatibility check.
 *
 * @example
 * ```ts
 * import { SDK_VERSION, isSDKVersionCompatible } from "@ax-code/sdk"
 *
 * console.log(SDK_VERSION) // "2.0.0"
 * if (!isSDKVersionCompatible("^2.0.0")) {
 *   throw new Error("This plugin requires @ax-code/sdk ^2.0.0")
 * }
 * ```
 */

/** Current SDK version. Matches the `version` field in package.json. */
export const SDK_VERSION = "2.0.0"

/**
 * Check whether the current SDK version satisfies a semver range.
 * Uses a simple major.minor check — does NOT pull in the full `semver`
 * package. Supports `^X.Y.Z` (caret) and `X.Y.Z` (exact) patterns.
 *
 * For full semver range evaluation (tilde, hyphen ranges, pre-release
 * tags), use the `semver` package directly against `SDK_VERSION`.
 */
export function isSDKVersionCompatible(required: string): boolean {
  const current = parseVersion(SDK_VERSION)
  if (!current) return false

  const caret = required.startsWith("^")
  const range = parseVersion(caret ? required.slice(1) : required)
  if (!range) return false

  if (caret) {
    // ^X.Y.Z — same major, current minor.patch >= required
    if (current.major !== range.major) return false
    if (current.minor < range.minor) return false
    if (current.minor === range.minor && current.patch < range.patch) return false
    return true
  }

  // Exact match
  return current.major === range.major && current.minor === range.minor && current.patch === range.patch
}

function parseVersion(v: string): { major: number; minor: number; patch: number } | undefined {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}
