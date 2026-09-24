#!/usr/bin/env node
// Goal check (AC5): the goal's commit range on main is focused and allowlisted.
//
// Asserts:
//   - the baseline is an ancestor of HEAD and the range is nonempty;
//   - HEAD is on the `main` branch;
//   - every commit subject is imperative, capitalized, <= 72 chars, no trailing period;
//   - no merge commit appears in the range;
//   - EVERY path of EVERY commit (additions, deletions, modifications, and both
//     sides of renames/copies) is inside the goal allowlist.
//
// Usage: node script/check-goal-commit-scope.mjs --baseline <sha>

import { execFileSync } from "node:child_process"

const ALLOW_DIRS = ["packages/ax-code/src/provider/ax-engine", "packages/ax-code/test/provider/ax-engine"]
const ALLOW_FILES = ["script/check-goal-cross-review.mjs", "script/check-goal-commit-scope.mjs"]

const NON_IMPERATIVE = new RegExp(
  "^(" +
    [
      "Added",
      "Adds",
      "Adding",
      "Fixed",
      "Fixes",
      "Fixing",
      "Removed",
      "Removes",
      "Removing",
      "Updated",
      "Updates",
      "Updating",
      "Changed",
      "Changes",
      "Changing",
      "Created",
      "Creates",
      "Creating",
      "Deleted",
      "Deletes",
      "Deleting",
      "Improved",
      "Improves",
      "Improving",
      "Refactored",
      "Refactors",
      "Refactoring",
      "Bumped",
      "Bumps",
      "Bumping",
      "Reverted",
      "Reverts",
      "Reverting",
      "Merged",
      "Merges",
      "Merging",
    ].join("|") +
    ")\\b",
)

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim()
}

function gitOk(args) {
  try {
    execFileSync("git", args, { stdio: ["ignore", "ignore", "ignore"] })
    return true
  } catch {
    return false
  }
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  if (i < 0) return undefined
  const value = process.argv[i + 1]
  return value && !value.startsWith("--") ? value : undefined
}

function allowed(p) {
  return ALLOW_FILES.includes(p) || ALLOW_DIRS.some((dir) => p === dir || p.startsWith(`${dir}/`))
}

function main() {
  const baseline = argValue("--baseline")
  if (!baseline) {
    console.error("usage: node script/check-goal-commit-scope.mjs --baseline <sha>")
    process.exit(2)
  }

  const problems = []

  if (!gitOk(["merge-base", "--is-ancestor", baseline, "HEAD"])) {
    console.error(`FAIL: baseline ${baseline} is not an ancestor of HEAD`)
    process.exit(1)
  }
  console.log(`baseline ${baseline} is an ancestor of HEAD`)

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch !== "main") problems.push(`HEAD is on branch ${branch}, expected main`)

  const commits = git(["rev-list", "--reverse", `${baseline}..HEAD`])
    .split("\n")
    .filter(Boolean)
  if (!commits.length) problems.push("commit range is empty")
  console.log(`range ${baseline}..HEAD: ${commits.length} commit(s)`)

  const allPaths = new Set()
  for (const sha of commits) {
    const short = sha.slice(0, 9)
    const parents = git(["rev-list", "--parents", "-n", "1", sha]).split(/\s+/).slice(1)
    if (parents.length > 1) problems.push(`${short} is a merge commit (${parents.length} parents)`)

    const subject = git(["log", "-1", "--format=%s", sha])
    if (!subject) problems.push(`${short} has an empty subject`)
    else {
      if (subject.length > 72) problems.push(`${short} subject exceeds 72 chars (${subject.length})`)
      if (/\.$/.test(subject)) problems.push(`${short} subject ends with a period: ${subject}`)
      if (/^[a-z]/.test(subject)) problems.push(`${short} subject is not capitalized: ${subject}`)
      if (NON_IMPERATIVE.test(subject)) problems.push(`${short} subject is not imperative: ${subject}`)
    }

    const nameStatus = git(["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", "-C", sha])
    for (const line of nameStatus.split("\n").filter(Boolean)) {
      const cols = line.split("\t")
      const status = cols[0]
      const paths = cols.slice(1).filter(Boolean)
      if (status.startsWith("R") || status.startsWith("C")) {
        // Rename/copy: both the source and the destination side must be allowlisted.
        if (paths.length < 2) problems.push(`${short} rename/copy line malformed: ${line}`)
        for (const p of paths) allPaths.add(p)
      } else if (paths.length >= 1) {
        allPaths.add(paths[0])
      } else {
        problems.push(`${short} unparseable diff-tree line: ${line}`)
      }
    }
  }

  console.log(`touched paths (${allPaths.size}):`)
  for (const p of [...allPaths].sort()) console.log(`  ${allowed(p) ? "ok " : "BAD"} ${p}`)
  for (const p of [...allPaths].sort()) {
    if (!allowed(p)) problems.push(`committed path is outside the allowlist: ${p}`)
  }

  if (problems.length) {
    for (const problem of problems) console.error(`PROBLEM: ${problem}`)
    console.error("\nFAIL: commit scope does not satisfy the goal contract")
    process.exit(1)
  }
  console.log(`\nPASS: ${commits.length} focused, allowlisted, imperative commit(s) on main`)
}

main()
