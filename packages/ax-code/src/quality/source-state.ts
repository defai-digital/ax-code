import { git } from "../util/git"
import { Hash } from "../util/hash"
import type { SourceState } from "./verification-envelope"

// Phase 1 (PRD D3): capture the worktree fingerprint a verification run is
// executed against, so envelope citations can be freshness-classified later
// (see classifyEnvelopeFreshness in @ax-code/ax-code-reason/quality/freshness).
//
// The fingerprint is `git rev-parse HEAD` plus a sha256 of
// `git status --porcelain --untracked-files=normal` — cheap, side-effect
// free, and directly comparable. The session Snapshot system is
// deliberately NOT used here: Snapshot.track() mutates git state (git add +
// ref writes under a project-private gitdir) and is config-gated, which is
// the wrong tool for a read-only freshness probe.

const UNAVAILABLE: SourceState = { available: false, commit: null, dirtyDigest: null }

export async function currentSourceState(worktreeRoot: string, vcs: string): Promise<SourceState> {
  if (vcs !== "git") return UNAVAILABLE

  const head = await git(["rev-parse", "HEAD"], { cwd: worktreeRoot })
  const commit = head.exitCode === 0 ? head.text().trim() || null : null

  const status = await git(["status", "--porcelain", "--untracked-files=normal"], { cwd: worktreeRoot })
  const dirtyDigest = status.exitCode === 0 ? Hash.fast(status.text()) : null

  // available stays true for a git project even when rev-parse fails (e.g. a
  // repo with no commits yet) — the dirty digest still fingerprints the
  // worktree, and the classifier compares null commits as equal.
  return { available: true, commit, dirtyDigest }
}
