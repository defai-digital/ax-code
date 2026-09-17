#!/usr/bin/env -S npx tsx

/**
 * Verifies the commit scope of the animation review fix.
 *
 * A focused commit must not carry local-only material into the public history:
 * no `.internal/` content, no root agent-instruction file (`AGENTS.md`,
 * `CLAUDE.md`, `GEMINI.md`), and no `ax-code.json` (the untracked local config).
 * This script makes that checkable instead of asserted: it
 * proves the baseline is an ancestor of HEAD, the range is non-empty, and then
 * enumerates every path of every commit in the range — including deletions and
 * both sides of a rename — rejecting any forbidden path.
 *
 * Usage:
 *   pnpm --dir packages/ax-code exec tsx script/verify-cli-review-commit-scope.ts --base <sha>
 */

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

export namespace CliReviewCommitScope {
  /** Path segments that may never appear in a review-fix commit. */
  export const ForbiddenSegments = [".internal"] as const
  export const ForbiddenBasenames = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "ax-code.json"] as const
}

export type CommitEntry = { sha: string; subject: string; paths: string[] }

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

export function parseArgs(argv: string[]): { base?: string; quiet: boolean } {
  let base: string | undefined
  let quiet = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--base") base = argv[++i]
    else if (arg === "--quiet") quiet = true
  }
  return { base, quiet }
}

/** Reject a path that would leak local-only or untracked material into history. */
export function forbiddenReason(filePath: string): string | undefined {
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean)
  for (const segment of CliReviewCommitScope.ForbiddenSegments) {
    if (segments.includes(segment)) return `under ${segment}/`
  }
  for (const basename of CliReviewCommitScope.ForbiddenBasenames) {
    if (segments.includes(basename)) return basename
  }
  return undefined
}

/**
 * Every path changed by one commit. `-m` also diffs a merge against each parent
 * and `--name-status` reports deletes (`D`) and renames (`R`) with both sides,
 * so no path in the commit is missed.
 */
export function commitPaths(root: string, sha: string): string[] {
  const raw = git(root, ["diff-tree", "--no-commit-id", "-r", "-m", "--name-status", "-z", sha])
  const tokens = raw.split("\0").filter((token) => token.length > 0)
  const paths: string[] = []
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++]!.trim()
    if (/^[RC]/.test(status)) paths.push(tokens[i++]!, tokens[i++]!)
    else paths.push(tokens[i++]!)
  }
  return paths
}

export function verify(input: { base: string; root: string }): { failures: string[]; lines: string[] } {
  const failures: string[] = []
  const lines: string[] = []
  const { base, root } = input

  let baseSha: string
  try {
    baseSha = git(root, ["rev-parse", "--verify", `${base}^{commit}`]).trim()
  } catch {
    return { failures: [`base ${base} is not a resolvable commit`], lines }
  }
  lines.push(`base ${baseSha}`)

  try {
    git(root, ["merge-base", "--is-ancestor", baseSha, "HEAD"])
  } catch {
    failures.push(`base ${baseSha} is not an ancestor of HEAD`)
  }

  const head = git(root, ["rev-parse", "HEAD"]).trim()
  lines.push(`head ${head}`)
  const commitList = git(root, ["rev-list", `${baseSha}..HEAD`])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (commitList.length === 0) {
    failures.push(`range ${baseSha}..HEAD is empty; the fix has no commit`)
    return { failures, lines }
  }

  let totalPaths = 0
  for (const sha of commitList) {
    const subject = git(root, ["show", "-s", "--format=%s", sha]).trim()
    const paths = commitPaths(root, sha)
    if (paths.length === 0) failures.push(`commit ${sha} touches no path`)
    lines.push(`commit ${sha} ${subject}`)
    const seen = new Set<string>()
    for (const filePath of paths) {
      if (seen.has(filePath)) continue
      seen.add(filePath)
      totalPaths++
      const reason = forbiddenReason(filePath)
      lines.push(`  ${reason ? "FORBIDDEN" : "ok"} ${filePath}${reason ? ` (${reason})` : ""}`)
      if (reason) failures.push(`commit ${sha} touches forbidden path ${filePath} (${reason})`)
    }
  }
  lines.push(`enumerated ${totalPaths} path(s) across ${commitList.length} commit(s) in ${baseSha}..HEAD`)
  return { failures, lines }
}

function main(): void {
  const root = repoRoot()
  const args = parseArgs(process.argv.slice(2))
  if (!args.base) {
    console.error("usage: verify-cli-review-commit-scope.ts --base <sha>")
    process.exit(2)
  }
  const { failures, lines } = verify({ base: args.base, root })
  if (!args.quiet) for (const line of lines) console.log(line)
  if (failures.length > 0) {
    console.error(`\ncli review commit-scope verification failed (${failures.length}):`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log(`\nOK: every path in the review-fix range is allowed`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
