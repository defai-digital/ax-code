/**
 * Distribution allowlist for vendored @ax-code/opentui-* packages.
 *
 * The CLI copies these workspace packages beside the Node TUI bundle because
 * they are not published to npm. The workspace tree still contains upstream
 * tests, type-only files, unused highlight grammars, and reviewable patch
 * docs — none of that belongs in a shipping archive.
 */
import { relative } from "node:path"

const DENY_PREFIXES = ["tests", "src", "scripts", "patches", "assets/zig", "lib/tree-sitter/assets"] as const

const BUILD_ONLY_DEP_PREFIXES = ["@babel/", "babel-"] as const

/** Drop Babel / Solid transform deps that only the source TUI build needs. */
export function withoutOpentuiBuildOnlyDependencies(deps?: Record<string, string>) {
  const out: Record<string, string> = {}
  for (const [name, version] of Object.entries(deps ?? {})) {
    if (BUILD_ONLY_DEP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
    out[name] = version
  }
  return out
}

const DENY_BASENAMES = new Set([
  "MAINTENANCE.md",
  "README.md",
  "native-event-worker-repro.worker.d.ts",
  "update-assets.js",
  "update-assets.d.ts",
])

const DENY_SUFFIXES = [".d.ts", ".bun.js"] as const

export function toPosixPath(value: string) {
  return value.split("\\").join("/")
}

/** Return false when `src` must not be copied into a Node TUI distribution. */
export function shouldCopyOpentuiDistPath(src: string, packageRoot: string) {
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

export const OPENTUI_DIST_DENY_PREFIXES = DENY_PREFIXES
export const OPENTUI_DIST_DENY_BASENAMES = DENY_BASENAMES
