import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"

const log = Log.create({ service: "file.directory-scope" })

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
  const MULTI_REPO_PARENT_MIN_NESTED = 2
  // Bounded two-level nested-git scan skips these names. They routinely
  // contain vendored checkouts and must not classify a real project as a
  // multi-repo parent or explode staging excludes.
  const NESTED_GIT_SKIP_NAMES = new Set(["node_modules", "dist", "build", "target", "vendor"])

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
   * Cheap, synchronous-ish (no directory listing) check for "is this home,
   * or a well-known home subfolder" — deliberately excludes the filesystem
   * root, since callers that need that too (or need to treat it
   * differently, e.g. File.scan's "skip entirely" vs. "shallow scan" split)
   * check `isFilesystemRoot` separately. `resolvedDir` must already be
   * realpath'd (e.g. via `Filesystem.resolve` or `Instance.directory`) so a
   * symlinked home/Desktop doesn't dodge it.
   */
  export function isHomeLikePath(resolvedDir: string): boolean {
    return knownBroadDirs().some((known) => Filesystem.resolve(known.path) === resolvedDir)
  }

  /**
   * Cheap, synchronous-ish (no directory listing) check for the internal
   * silent guards in code-intelligence/auto-index.ts, which treat "home-like"
   * and "filesystem root" identically (skip entirely either way).
   */
  export function isKnownBroadDirectory(resolvedDir: string): boolean {
    return isFilesystemRoot(resolvedDir) || isHomeLikePath(resolvedDir)
  }

  async function hasDotGit(dir: string): Promise<boolean> {
    try {
      await fs.lstat(path.join(dir, ".git"))
      return true
    } catch (error) {
      if (!Filesystem.isEnoent(error)) {
        log.warn("failed to inspect .git for directory-scope classification", { dir, error })
      }
      return false
    }
  }

  function asGitPathspec(relative: string): string {
    return relative.split(path.sep).join("/")
  }

  /**
   * Bounded two-level listing of child paths that look like git checkouts
   * (have a `.git` file or directory). Does not recurse into junk names.
   * Classification (`isMultiRepoParent`) skips top-level dot-directories so
   * caches do not count; staging excludes pass `{ includeDotDirs: true }`
   * because `git add` does enter them. Paths are relative to `dir` with `/`
   * separators so they can be used as git pathspecs.
   */
  export async function nestedGitChildren(dir: string, opts?: { includeDotDirs?: boolean }): Promise<string[]> {
    const resolved = Filesystem.resolve(dir)
    const includeDotDirs = opts?.includeDotDirs === true
    const found: string[] = []
    const top = await fs.readdir(resolved, { withFileTypes: true }).catch((error) => {
      if (!Filesystem.isEnoent(error)) {
        log.warn("failed to list directory for nested-git classification", { dir: resolved, error })
      }
      return []
    })
    for (const entry of top) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (entry.name === "." || entry.name === ".." || entry.name === ".git") continue
      if (NESTED_GIT_SKIP_NAMES.has(entry.name)) continue
      const abs = path.join(resolved, entry.name)
      if (await hasDotGit(abs)) {
        found.push(asGitPathspec(entry.name))
        continue
      }
      if (!includeDotDirs && entry.name.startsWith(".")) continue
      const inner = await fs.readdir(abs, { withFileTypes: true }).catch((error) => {
        if (!Filesystem.isEnoent(error)) {
          log.warn("failed to list nested directory for nested-git classification", { dir: abs, error })
        }
        return []
      })
      for (const child of inner) {
        if (!child.isDirectory() && !child.isSymbolicLink()) continue
        if (child.name === ".git" || NESTED_GIT_SKIP_NAMES.has(child.name)) continue
        if (await hasDotGit(path.join(abs, child.name))) {
          found.push(asGitPathspec(path.join(entry.name, child.name)))
        }
      }
    }
    return found
  }

  /**
   * A directory that is not itself a git checkout but contains multiple
   * nested git children (e.g. `~/code`). Coverage and indexing degrade;
   * startup does not refuse. Home-like and filesystem-root paths keep their
   * own guards and are not classified here.
   */
  export async function isMultiRepoParent(dir: string): Promise<boolean> {
    const resolved = Filesystem.resolve(dir)
    if (isFilesystemRoot(resolved) || isHomeLikePath(resolved)) return false
    if (await hasDotGit(resolved)) return false
    const nested = await nestedGitChildren(resolved)
    return nested.length >= MULTI_REPO_PARENT_MIN_NESTED
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
    } catch (error) {
      if (!Filesystem.isEnoent(error)) {
        log.warn("failed to list directory for the top-level entry-count check", { dir, error })
      }
      return 0
    }
  }
}
