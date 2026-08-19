import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"

const ESM_EXPORT_CONDITIONS = ["import", "node", "default"] as const

export namespace Module {
  export function resolve(id: string, dir: string) {
    try {
      return createRequire(path.join(dir, "package.json")).resolve(id)
    } catch {}
  }

  /**
   * Resolve a package directory (or file) to the file Node should `import()`.
   * `import(packageDir)` throws ERR_UNSUPPORTED_DIR_IMPORT even when
   * package.json has `exports`; Homebrew/compiled ax-code hits this after
   * BunProc.install() returns the package folder.
   */
  export function resolveEntry(target: string): string | undefined {
    const stat = statAt(target)
    if (!stat) return undefined
    if (stat.isFile()) return asFile(target)
    if (!stat.isDirectory()) return undefined

    const packageDir = path.resolve(target)
    const fromRequire = confineToPackage(packageDir, resolve(".", packageDir))
    if (fromRequire) return fromRequire
    return confineToPackage(packageDir, resolveEntryFromManifest(packageDir))
  }
}

function statAt(target: string) {
  try {
    return fs.statSync(target)
  } catch {
    return undefined
  }
}

function asFile(target: string): string | undefined {
  const stat = statAt(target)
  if (!stat?.isFile()) return undefined
  try {
    return fs.realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

function confineToPackage(packageDir: string, entry: string | undefined): string | undefined {
  if (!entry) return undefined
  const realPkg = realpathOrResolve(packageDir)
  const resolved = (() => {
    try {
      return fs.realpathSync(path.resolve(packageDir, entry))
    } catch {
      return undefined
    }
  })()
  if (!resolved) return undefined
  if (!isInside(realPkg, resolved)) return undefined
  return asFile(resolved)
}

function realpathOrResolve(target: string) {
  try {
    return fs.realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

function isInside(parent: string, child: string) {
  const rel = path.relative(parent, child)
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

function resolveEntryFromManifest(packageDir: string): string | undefined {
  const manifestPath = path.join(packageDir, "package.json")
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (!manifest || typeof manifest !== "object") return undefined
  const fromExports = pickExport(manifest.exports, ESM_EXPORT_CONDITIONS)
  const relative = fromExports ?? stringField(manifest.module) ?? stringField(manifest.main)
  return relative ? path.resolve(packageDir, relative) : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function pickExport(value: unknown, conditions: readonly string[]): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickExport(item, conditions)
      if (picked) return picked
    }
    return undefined
  }
  if (!value || typeof value !== "object") return undefined
  const rec = value as Record<string, unknown>
  if ("." in rec) return pickExport(rec["."], conditions)
  for (const condition of conditions) {
    if (!(condition in rec)) continue
    const picked = pickExport(rec[condition], conditions)
    if (picked) return picked
  }
  return undefined
}
