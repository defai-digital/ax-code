/**
 * Compatibility gate between this app and the installed ax-code runtime.
 *
 * The desktop consumes the workspace @ax-code/sdk, but the ax-code CLI on the
 * user's machine can update independently. This module defines the oldest
 * runtime the app is known to work with and evaluates the version reported by
 * the runtime's /global/health endpoint against it.
 *
 * Bump MIN_SUPPORTED_AX_CODE_VERSION whenever the app starts depending on a
 * newer server API (see docs/AX_CODE_REVENDOR_CHECKLIST.md).
 */

// v6.8.0 added the ax-engine local-model routes (/provider/ax-engine/*) the
// Models tab depends on. Without them, older runtimes return a bare 404 that
// surfaces as a cryptic "Provider request failed (404)" instead of the
// incompatible-runtime warning. Earlier baseline was v5.11.1 (server fixes for
// config PATCH, command handling, and route validation this app relies on).
export const MIN_SUPPORTED_AX_CODE_VERSION = "6.8.0"

export const parseVersionForComparison = (value) => {
  const normalized = String(value || "")
    .replace(/^v/, "")
    .split("+")[0]
  const prereleaseIndex = normalized.indexOf("-")
  const core = prereleaseIndex >= 0 ? normalized.slice(0, prereleaseIndex) : normalized
  const suffix = prereleaseIndex >= 0 ? normalized.slice(prereleaseIndex + 1) : ""
  const prerelease = /^(alpha|beta|rc|pre|preview|next)(?:[.-]|\d|$)/i.test(suffix)
  const parts = core.split(".").map((part) => {
    const parsed = Number.parseInt(part || "0", 10)
    return Number.isFinite(parsed) ? parsed : 0
  })
  return { parts, prerelease }
}

export const compareVersions = (left, right) => {
  const a = parseVersionForComparison(left)
  const b = parseVersionForComparison(right)
  const length = Math.max(a.parts.length, b.parts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (a.parts[index] || 0) - (b.parts[index] || 0)
    if (diff !== 0) return diff
  }
  if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1
  return 0
}

const normalizeVersion = (value) => {
  if (typeof value !== "string") return null
  const trimmed = value.trim().replace(/^v/, "")
  return /^\d+\.\d+/.test(trimmed) ? trimmed : null
}

/**
 * Returns { version, minSupportedVersion, compatible } where compatible is
 * null when the runtime version is unknown or unparseable.
 */
export const evaluateAxCodeCompatibility = (rawVersion, minSupportedVersion = MIN_SUPPORTED_AX_CODE_VERSION) => {
  const version = normalizeVersion(rawVersion)
  return {
    version,
    minSupportedVersion,
    compatible: version === null ? null : compareVersions(version, minSupportedVersion) >= 0,
  }
}
