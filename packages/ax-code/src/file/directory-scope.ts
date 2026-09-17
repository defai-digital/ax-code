import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

/**
 * Detects when a directory is unlikely to be a real ax-code workspace —
 * the home directory, a well-known home subfolder (Desktop/Downloads/
 * Documents), a filesystem root, or a directory with an unusually large
 * top-level listing. Used both by the CLI startup guard (which asks the
 * user before proceeding) and by the internal indexing/scan guards (which
 * silently fall back to a cheaper path with no user to ask).
 */
export namespace DirectoryScope {
  const DEFAULT_MAX_TOP_LEVEL_ENTRIES = 300

  function knownBroadDirs(): { path: string; reason: string }[] {
    const home = Global.Path.home
    return [
      { path: home, reason: "this is your home directory" },
      { path: path.join(home, "Desktop"), reason: "this is your Desktop folder" },
      { path: path.join(home, "Downloads"), reason: "this is your Downloads folder" },
      { path: path.join(home, "Documents"), reason: "this is your Documents folder" },
    ]
  }

  /** Home, Desktop, Downloads, Documents — never a sensible ax-code workspace root. */
  export function wellKnownBroadPaths(): string[] {
    return knownBroadDirs().map((d) => d.path)
  }

  export function isFilesystemRoot(dir: string): boolean {
    return dir === path.parse(dir).root
  }

  /**
   * Cheap, synchronous-ish (no directory listing) check for the internal
   * silent guards in file/index.ts and code-intelligence/auto-index.ts.
   * `resolvedDir` must already be realpath'd (e.g. via `Filesystem.resolve`
   * or `Instance.directory`) so a symlinked home/Desktop doesn't dodge it.
   */
  export function isKnownBroadDirectory(resolvedDir: string): boolean {
    if (isFilesystemRoot(resolvedDir)) return true
    return knownBroadDirs().some((known) => Filesystem.resolve(known.path) === resolvedDir)
  }

  export interface Assessment {
    broad: boolean
    reason?: string
  }

  /**
   * Full assessment used by the CLI startup guard: known-broad paths and
   * filesystem root (cheap), then falls back to a single non-recursive
   * `readdir` count against `maxTopLevelEntries` — never a recursive walk.
   */
  export async function assess(
    dir: string,
    opts?: { maxTopLevelEntries?: number; extraDenylist?: string[] },
  ): Promise<Assessment> {
    const resolved = Filesystem.resolve(dir)

    if (isFilesystemRoot(resolved)) return { broad: true, reason: "this is a filesystem root" }

    for (const known of knownBroadDirs()) {
      if (Filesystem.resolve(known.path) === resolved) return { broad: true, reason: known.reason }
    }

    for (const extra of opts?.extraDenylist ?? []) {
      if (Filesystem.resolve(extra) === resolved) {
        return { broad: true, reason: "this directory is on your configured denylist" }
      }
    }

    const maxTopLevelEntries = opts?.maxTopLevelEntries ?? DEFAULT_MAX_TOP_LEVEL_ENTRIES
    const count = await topLevelEntryCount(resolved)
    if (count > maxTopLevelEntries) {
      return { broad: true, reason: `this directory has ${count} top-level entries` }
    }

    return { broad: false }
  }

  async function topLevelEntryCount(dir: string): Promise<number> {
    try {
      return (await fs.readdir(dir)).length
    } catch {
      return 0
    }
  }
}
