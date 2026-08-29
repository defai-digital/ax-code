#!/usr/bin/env -S npx tsx
/**
 * Repo guard: the Desktop installer bundles the ax-code CLI runtime pinned to
 * the Desktop app version (SPEC-2026-08-29-desktop-runtime-bundling). Release
 * staging downloads the sibling CLI release `v<version>` and fails closed, so
 * the CLI package and all three Desktop packages must share one version
 * string before a desktop release is cut.
 *
 * Run:  tsx script/check-desktop-version-lockstep.ts
 * Wire: desktop-release.yml preflight
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// The CLI manifest is the reference; every Desktop package must match it.
export const LOCKSTEP_MANIFESTS = [
  "packages/ax-code/package.json",
  "desktop/packages/electron/package.json",
  "desktop/packages/web/package.json",
  "desktop/packages/ui/package.json",
] as const

export type ManifestVersion = { manifest: string; version: string }

export function readManifestVersions(
  root: string,
  manifests: readonly string[] = LOCKSTEP_MANIFESTS,
): ManifestVersion[] {
  return manifests.map((manifest) => {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, manifest), "utf8")) as { version?: unknown }
    const version = typeof parsed.version === "string" ? parsed.version.trim() : ""
    return { manifest, version }
  })
}

/** Returns the entries that drifted from the reference (CLI) version. */
export function findLockstepDrift(entries: ManifestVersion[]): ManifestVersion[] {
  const reference = entries[0]?.version || ""
  return entries.filter((entry) => entry.version !== reference)
}

function main() {
  const root = path.resolve(import.meta.dirname, "..")
  const entries = readManifestVersions(root)

  const missing = entries.filter((entry) => !entry.version)
  if (missing.length > 0) {
    console.error("Version lockstep check failed: manifest(s) without a version:")
    for (const entry of missing) console.error(`- ${entry.manifest}`)
    process.exitCode = 1
    return
  }

  const drift = findLockstepDrift(entries)
  if (drift.length > 0) {
    console.error(`Version lockstep check failed: expected all packages at ${entries[0].version}:`)
    for (const entry of entries) console.error(`- ${entry.manifest}: ${entry.version}`)
    console.error("The Desktop installer bundles the CLI runtime pinned to the app version; bump all four together.")
    process.exitCode = 1
    return
  }

  console.log(`Version lockstep check passed (${entries[0].version}, ${entries.length} manifests).`)
}

const entry = process.argv[1]
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exitCode = 1
  }
}
