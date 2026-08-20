/**
 * Distribution allowlist for the private @ax-code/tui package.
 *
 * The CLI copies this workspace package beside the Node TUI bundle because it
 * is not published to npm. The workspace tree still contains upstream
 * tests, type-only files, unused highlight grammars, and reviewable patch
 * docs — none of that belongs in a shipping archive.
 */
import { relative } from "node:path"

const DENY_PREFIXES = [
  "tests",
  "patches",
  "assets/zig",
  "lib/tree-sitter/assets",
  "solid/patches",
  "spinner/src",
] as const

const TUI_TRANSFORM_DEPENDENCIES = new Set([
  "@babel/core",
  "@babel/preset-typescript",
  "babel-plugin-module-resolver",
  "babel-preset-solid",
])

/**
 * Drop dependencies used exclusively by the public `@ax-code/tui/solid/transform`
 * entry from the precompiled CLI distribution. The package manifest keeps
 * these as production dependencies so the exported transform remains usable
 * when the source package is consumed inside this workspace.
 */
export function withoutTuiTransformDependencies(deps?: Record<string, string>) {
  return Object.fromEntries(Object.entries(deps ?? {}).filter(([name]) => !TUI_TRANSFORM_DEPENDENCIES.has(name)))
}

type JsonObject = Record<string, unknown>

function pruneMissingExportTargets(value: unknown, exists: (relativePath: string) => boolean): unknown {
  if (typeof value === "string") {
    if (!value.startsWith("./")) return value
    return exists(value.slice(2)) ? value : undefined
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value

  const entries = Object.entries(value as JsonObject)
    .map(([condition, target]) => [condition, pruneMissingExportTargets(target, exists)] as const)
    .filter((entry) => entry[1] !== undefined)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/**
 * Rewrite the copied package manifest to describe the precompiled distribution
 * rather than the source workspace. Type declarations, Bun/build entries, and
 * the Solid transform are intentionally pruned by the copy allowlist; leaving
 * their exports or dependencies behind creates a package with dangling public
 * paths and a misleading install contract.
 */
export function toTuiDistPackageJson(input: JsonObject, exists: (relativePath: string) => boolean) {
  const output = structuredClone(input)
  output.dependencies = withoutTuiTransformDependencies(output.dependencies as Record<string, string> | undefined)
  delete output.devDependencies
  delete output.scripts

  const exports = output.exports as JsonObject | undefined
  if (exports) {
    output.exports = Object.fromEntries(
      Object.entries(exports)
        .map(([subpath, target]) => [subpath, pruneMissingExportTargets(target, exists)] as const)
        .filter((entry) => entry[1] !== undefined),
    )
  }
  return output
}

const DENY_BASENAMES = new Set([
  "MAINTENANCE.md",
  "README.md",
  "UPSTREAM.md",
  "DIVERGENCES.md",
  "solid/scripts/solid-transform.js",
  "native-event-worker-repro.worker.d.ts",
  "update-assets.js",
  "update-assets.d.ts",
])

const DENY_SUFFIXES = [".d.ts", ".bun.js"] as const

export function toPosixPath(value: string) {
  return value.split("\\").join("/")
}

/** Return false when `src` must not be copied into a Node TUI distribution. */
export function shouldCopyTuiDistPath(src: string, packageRoot: string) {
  const rel = toPosixPath(relative(packageRoot, src))
  if (!rel || rel === ".") return true
  const parts = rel.split("/")
  if (parts.includes("node_modules")) return false
  if (parts.some((part) => part.startsWith("."))) return false

  for (const prefix of DENY_PREFIXES) {
    if (rel === prefix || rel.startsWith(`${prefix}/`)) return false
  }
  const base = parts[parts.length - 1] ?? ""
  if (DENY_BASENAMES.has(base) || DENY_BASENAMES.has(rel)) return false
  for (const suffix of DENY_SUFFIXES) {
    if (rel.endsWith(suffix)) return false
  }
  return true
}

export const TUI_DIST_DENY_PREFIXES = DENY_PREFIXES
export const TUI_DIST_DENY_BASENAMES = DENY_BASENAMES
