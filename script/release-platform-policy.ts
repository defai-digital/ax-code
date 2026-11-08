import { readFileSync } from "node:fs"

export const releasePlatformPolicy = JSON.parse(
  readFileSync(new URL("../docs/release/platforms.json", import.meta.url), "utf8"),
) as {
  windowsX64OnlyFrom: string
  archives: string[]
  legacyWindowsArm64Archive: string
  libraryArchivesFrom: string
  libraryArchives: string[]
}

/** True when `version` (a release version or tag) sorts before the `cutoff` core version. */
function isBefore(version: string, cutoff: string) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) throw new Error(`Invalid release version: ${version}`)
  const current = match.slice(1, 4).map(Number)
  const boundary = cutoff.split(".").map(Number)
  for (let index = 0; index < 3; index++) {
    if (current[index] !== boundary[index]) return current[index]! < boundary[index]!
  }
  return false
}

export function supportsLegacyWindowsArm64(version?: string) {
  if (version === undefined) return false
  return isBefore(version, releasePlatformPolicy.windowsX64OnlyFrom)
}

export function releaseArchives(version?: string) {
  const archives = [...releasePlatformPolicy.archives]
  if (supportsLegacyWindowsArm64(version)) archives.splice(2, 0, releasePlatformPolicy.legacyWindowsArm64Archive)
  return archives
}

/**
 * Library packages attached to a release for other products to pin by tag and digest, such as
 * the Worker-hosted diff engine consumed by AX Code Desktop. Earlier releases never carried them.
 * An omitted version means the release being built now.
 */
export function releaseLibraryArchives(version?: string) {
  if (version !== undefined && isBefore(version, releasePlatformPolicy.libraryArchivesFrom)) return []
  return [...releasePlatformPolicy.libraryArchives]
}
