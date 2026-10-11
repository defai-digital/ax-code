import { readFileSync } from "node:fs"

export const releasePlatformPolicy = JSON.parse(
  readFileSync(new URL("../docs/release/platforms.json", import.meta.url), "utf8"),
) as { windowsX64OnlyFrom: string; archives: string[]; legacyWindowsArm64Archive: string }

export function supportsLegacyWindowsArm64(version?: string) {
  if (version === undefined) return false
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) throw new Error(`Invalid release version: ${version}`)
  const current = match.slice(1, 4).map(Number)
  const cutoff = releasePlatformPolicy.windowsX64OnlyFrom.split(".").map(Number)
  for (let index = 0; index < 3; index++) {
    if (current[index] !== cutoff[index]) return current[index]! < cutoff[index]!
  }
  return false
}

export function releaseArchives(version?: string) {
  const archives = [...releasePlatformPolicy.archives]
  if (supportsLegacyWindowsArm64(version)) archives.splice(2, 0, releasePlatformPolicy.legacyWindowsArm64Archive)
  return archives
}
