import { codeReasonHost } from "./host"
import path from "path"

import { Process } from "./internal/process"
import { uniqueStrings } from "./internal/string-list"
import type { SourceState } from "./quality/freshness"

// incremental — Git-diff-aware file selection for scanner incremental mode.
//
// Instead of scanning every file on every run, incremental mode uses
// `git diff --name-only` to identify files changed since a reference
// point (commit SHA, branch, or timestamp). Scanners can pass these
// files to their `files` parameter to restrict scanning scope.
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
    const cwd = codeReasonHost().projectRoot()
    const maxFiles = opts?.maxFiles ?? 500
    const includeGlobs = opts?.include ?? ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs"]

    // Get changed files from git. Use --diff-filter=ACMR to exclude
    // deleted files (D) — we can't scan files that no longer exist.
    const result = await Process.text(
      ["git", "diff", "--name-only", "--diff-filter=ACMR", ref, "--", ...includeGlobs],
      {
        cwd,
        nothrow: true,
      },
    ).then((out) => out.text)
    const relPaths = result
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)

    const files = relPaths.map((rel) => path.resolve(cwd, rel)).filter((f) => codeReasonHost().containsPath(f))
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
    const cwd = codeReasonHost().projectRoot()
    const maxFiles = opts?.maxFiles ?? 500
    const includeGlobs = opts?.include ?? ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs"]

    // Use git log to find the commit closest to `seconds` ago, then
    // diff against it.
    const sinceDate = new Date(Date.now() - seconds * 1000).toISOString()
    const ref = await Process.text(["git", "log", `--since=${sinceDate}`, "--format=%H", "--reverse"], {
      cwd,
      nothrow: true,
    }).then((out) => out.text)
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
    const cwd = codeReasonHost().projectRoot()
    const maxFiles = opts?.maxFiles ?? 500
    const includeGlobs = opts?.include ?? ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]

    // Fixed-string grep of basenames (separate argv, never interpolated into a
    // shell or `-E` regex). A superset of true importers is safe: extra files
    // are only extra incremental work.
    const bases = [
      ...new Set(changedFiles.map((f) => path.basename(f, path.extname(f))).filter((base) => base.length > 0)),
    ]
    if (bases.length === 0) return []

    const result = await Process.text(
      ["git", "grep", "-l", "-F", ...bases.flatMap((base) => ["-e", base]), "--", ...includeGlobs],
      {
        cwd,
        nothrow: true,
      },
    ).then((out) => out.text)

    const importers = result
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((rel) => path.resolve(cwd, rel))
      .filter((f) => codeReasonHost().containsPath(f))
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
    const all = uniqueStrings([...changed.files, ...importers])
    const maxFiles = opts?.maxFiles ?? 500

    return {
      files: all.slice(0, maxFiles),
      ref: changed.ref,
      truncated: all.length > maxFiles || changed.truncated,
    }
  }
}

// ─── Incremental equivalence (PRD G4 / D4) ─────────────────────────────
//
// An incremental re-analysis is only equivalent to a full run when the graph
// revision AND the source fingerprint are continuous with the prior run. The
// context pair below is the engine's invalidation boundary: `revision` is the
// derived graph revision hash (host.graphRevision(), null when the index
// cursor is missing), and `source` is the worktree fingerprint
// (host.sourceState()). When continuity can't be established — null/regressed
// revision, unavailable source, or a moved/dirtied worktree — callers MUST
// fall back to a full analysis.

export type IncrementalContext = {
  revision: string | null
  source: SourceState | null
}

// True when the prior incremental base can no longer be trusted, so a full
// run is required. Falls back to full whenever:
//   - the current revision is null (no index cursor), or
//   - the prior revision is null (nothing to compare against), or
//   - the revision changed (regress or move),
//   - either source fingerprint is missing/unavailable, or
//   - the source commit or dirty digest moved.
export function shouldFallbackToFull(prev: IncrementalContext, next: IncrementalContext): boolean {
  if (next.revision === null) return true
  if (prev.revision === null) return true
  if (prev.revision !== next.revision) return true

  const p = prev.source
  const n = next.source
  if (p === null || n === null) return true
  if (p.available !== n.available) return true
  if (p.commit !== n.commit) return true
  if (p.dirtyDigest !== n.dirtyDigest) return true
  return false
}

// Findings whose `file` is in `changedFiles` (the rescan set — typically the
// changed files plus their importers). These must be dropped from the carried-
// over previous results because they are about to be recomputed; carrying them
// over would double-count. Pure: operates on any finding-like shape with a
// `file` field (scanner findings, quality findings, etc.).
export function computeObsoleteFindings<T extends { file: string }>(
  previous: readonly T[],
  changedFiles: ReadonlySet<string> | readonly string[],
): T[] {
  const changed = changedFiles instanceof Set ? changedFiles : new Set(changedFiles)
  return previous.filter((finding) => changed.has(finding.file))
}
