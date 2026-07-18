import { lstat } from "node:fs/promises"
import path from "node:path"
import { sanitizeWikiDir } from "./paths"

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

export async function assertWikiDirectorySafe(root: string, wikiDir?: string): Promise<void> {
  const resolvedRoot = path.resolve(root)
  const relative = sanitizeWikiDir(wikiDir)
  const segments = relative.split("/")
  let current = resolvedRoot
  for (const segment of segments) {
    current = path.join(current, segment)
    const info = await lstat(current).catch((error) => {
      if (isMissing(error)) return undefined
      throw error
    })
    if (!info) return
    if (info.isSymbolicLink()) {
      throw new Error(`AX Wiki refuses symlinked output paths: ${path.relative(resolvedRoot, current)}`)
    }
    if (!info.isDirectory()) {
      throw new Error(`AX Wiki output path is not a directory: ${path.relative(resolvedRoot, current)}`)
    }
  }
}
