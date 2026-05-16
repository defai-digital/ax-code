import { $ } from "bun"
import path from "path"
import { Instance } from "../project/instance"

// incremental — Git-diff-aware file selection for scanner incremental mode.
//
// Instead of scanning every file on every run, incremental mode uses
// `git diff --name-only` to identify files changed since a reference
// point (commit SHA, branch, or timestamp). Scanners can pass these
// files to their `include` parameter to restrict scanning scope.
//
// This is intentionally lightweight — no new DB table, no cursor
// management. Git is the single source of truth for what changed.

export namespace Incremental {
  export type ChangedFilesResult = {
    files: string[]
    ref: string
    truncated: boolean
  }

  // Get files changed since a git reference (commit SHA, branch name,
  // tag, or relative ref like `HEAD~5`).
  export async function changedFilesSince(
    ref: string,
    opts?: { include?: string[]; maxFiles?: number },
  ): Promise<ChangedFilesResult> {
    const cwd = Instance.directory
    const maxFiles = opts?.maxFiles ?? 500
    const includeGlobs = opts?.include ?? ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs"]

    // Get changed files from git. Use --diff-filter=ACMR to exclude
    // deleted files (D) — we can't scan files that no longer exist.
    const result = await $`git diff --name-only --diff-filter=ACMR ${ref} -- ${includeGlobs.join(" ")}`
      .cwd(cwd)
      .text()
      .catch(() => "")
    const relPaths = result
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)

    const files = relPaths.map((rel) => path.resolve(cwd, rel)).filter((f) => Instance.containsPath(f))
    const truncated = files.length > maxFiles

    return {
      files: files.slice(0, maxFiles),
      ref,
      truncated,
    }
  }

  // Get files changed in the last N seconds. Useful for "scan changes
  // since last scan" without needing to track a commit SHA.
  export async function changedFilesInWindow(
    seconds: number,
    opts?: { include?: string[]; maxFiles?: number },
  ): Promise<ChangedFilesResult> {
    const cwd = Instance.directory
    const maxFiles = opts?.maxFiles ?? 500
    const includeGlobs = opts?.include ?? ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs"]

    // Use git log to find the commit closest to `seconds` ago, then
    // diff against it.
    const sinceDate = new Date(Date.now() - seconds * 1000).toISOString()
    const ref = await $`git log --since=${sinceDate} --format=%H --reverse`
      .cwd(cwd)
      .text()
      .catch(() => "")
    const firstCommit = ref.trim().split("\n")[0]

    if (!firstCommit) {
      // No commits in the window — return empty
      return { files: [], ref: `since-${seconds}s`, truncated: false }
    }

    return changedFilesSince(`${firstCommit}^`, { include: includeGlobs, maxFiles })
  }

  // Get files that import a given set of changed files. This provides
  // transitive invalidation — if file A changed, and file B imports A,
  // file B should also be rescanned.
  //
  // Uses a simple grep-based approach: for each changed file, find
  // files that import it by name. This is O(changed × all_files) but
  // at current scale (~500 files) this completes in <100ms.
  export async function findImporters(
    changedFiles: string[],
    opts?: { include?: string[]; maxFiles?: number },
  ): Promise<string[]> {
    const cwd = Instance.directory
    const maxFiles = opts?.maxFiles ?? 500
    const includeGlobs = opts?.include ?? ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]

    // Build import patterns from changed file basenames
    const patterns = changedFiles.map((f) => {
      const base = path.basename(f, path.extname(f))
      // Match import statements referencing this module — escape regex metacharacters
      return base.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    })

    if (patterns.length === 0) return []

    // Use git grep for speed — it respects .gitignore automatically
    const pattern = patterns.join("|")
    const result = await $`git grep -l -E "from\\s+['\"].*(?:${pattern})['\"]" -- ${includeGlobs.join(" ")}`
      .cwd(cwd)
      .text()
      .catch(() => "")

    const importers = result
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((rel) => path.resolve(cwd, rel))
      .filter((f) => Instance.containsPath(f))
      // Exclude the changed files themselves — they're already in the scan set
      .filter((f) => !changedFiles.includes(f))

    return importers.slice(0, maxFiles)
  }

  // Convenience: get the full set of files to scan incrementally.
  // Returns changed files + their importers, deduplicated.
  export async function filesToScan(
    ref: string,
    opts?: { include?: string[]; maxFiles?: number; transitive?: boolean },
  ): Promise<ChangedFilesResult> {
    const changed = await changedFilesSince(ref, opts)
    if (!opts?.transitive || changed.files.length === 0) return changed

    const importers = await findImporters(changed.files, opts)
    const all = [...new Set([...changed.files, ...importers])]
    const maxFiles = opts?.maxFiles ?? 500

    return {
      files: all.slice(0, maxFiles),
      ref: changed.ref,
      truncated: all.length > maxFiles || changed.truncated,
    }
  }
}
