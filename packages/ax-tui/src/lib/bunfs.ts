import { basename, join } from "node:path"

export function isBunfsPath(path: string): boolean {
  // Match only the embedded-filesystem roots, not names that merely contain
  // "$bunfs" or "~BUN" (e.g. "$bunfs-local", "B:\~BUNNY").
  return /^\/\$bunfs\//.test(path) || /^B:[\\/]~BUN[\\/]/i.test(path)
}

export function getBunfsRootPath(): string {
  return process.platform === "win32" ? "B:\\~BUN\\root" : "/$bunfs/root"
}

/**
 * Normalizes a path to the embedded root.
 * Flattens directory structure to ensure file exists at root.
 */
export function normalizeBunfsPath(fileName: string): string {
  return join(getBunfsRootPath(), basename(fileName))
}
