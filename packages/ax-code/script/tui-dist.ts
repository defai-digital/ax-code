/**
 * Distribution allowlist for bundling the ax-tui package into the AX Code
 * Node TUI distribution.
 *
 * The AX Code CLI copies the installed ax-tui package beside its Node TUI
 * bundle instead of installing it from a registry. The installed tree still
 * contains upstream tests, type-only files, unused highlight grammars, and
 * reviewable patch docs — none of that belongs in a shipping archive.
 *
 * These helpers are the consumer-side counterpart of the framework's release
 * contract; they moved here with ADR-074 when the framework extraction made
 * `script/tui-dist.ts` part of the ax-tui repo.
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
 * Drop dependencies used exclusively by the public `ax-tui/solid/transform`
 * entry from a precompiled downstream distribution. The package manifest keeps
 * these as production dependencies so the exported transform remains usable
 * when the source package is consumed directly.
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
    .filter(([condition]) => condition !== "bun")
    .map(([condition, target]) => [condition, pruneMissingExportTargets(target, exists)] as const)
    .filter((entry) => entry[1] !== undefined)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function materializeDependencyVersions(
  dependencies: Record<string, string> | undefined,
  resolveCatalogVersion: (name: string) => string,
) {
  return Object.fromEntries(
    Object.entries(dependencies ?? {}).map(([name, version]) => [
      name,
      version.startsWith("catalog:") ? resolveCatalogVersion(name) : version,
    ]),
  )
}

/**
 * Rewrite the copied package manifest to describe the precompiled distribution
 * rather than the source package. Type declarations, Bun/build entries, and
 * the Solid transform are intentionally pruned by the copy allowlist; leaving
 * their exports or dependencies behind creates a package with dangling public
 * paths and a misleading install contract.
 */
export function toTuiDistPackageJson(
  input: JsonObject,
  exists: (relativePath: string) => boolean,
  resolveCatalogVersion: (name: string) => string,
) {
  const output = structuredClone(input)
  if (output.dependencies) {
    output.dependencies = materializeDependencyVersions(
      withoutTuiTransformDependencies(output.dependencies as Record<string, string>),
      resolveCatalogVersion,
    )
  }
  if (output.peerDependencies) {
    output.peerDependencies = materializeDependencyVersions(
      output.peerDependencies as Record<string, string>,
      resolveCatalogVersion,
    )
  }
  delete output.devDependencies
  delete output.scripts

  for (const field of ["main", "module", "types"] as const) {
    const target = output[field]
    if (typeof target === "string" && !exists(target.replace(/^\.\//, ""))) delete output[field]
  }

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
