import { existsSync } from "node:fs"
import path from "node:path"

export function desktopPackagingRepoRoot() {
  return path.resolve(import.meta.dirname, "../../..", "..")
}

export function resolveDesktopPackagingCliPath(value: string | undefined, repoRoot = desktopPackagingRepoRoot()) {
  if (!value) return undefined
  if (path.isAbsolute(value)) return value
  const repoRootPath = path.resolve(repoRoot, value)
  if (isRepoRelativePath(value)) return repoRootPath
  const cwdPath = path.resolve(value)
  if (existsSync(cwdPath)) return cwdPath
  if (existsSync(repoRootPath)) return repoRootPath
  return cwdPath
}

function isRepoRelativePath(value: string) {
  const normalized = value.replace(/\\/g, "/")
  return (
    normalized.startsWith("packages/") ||
    normalized.startsWith("crates/") ||
    normalized.startsWith("docs/") ||
    normalized.startsWith("script/") ||
    normalized.startsWith(".github/") ||
    normalized.startsWith(".internal/")
  )
}
