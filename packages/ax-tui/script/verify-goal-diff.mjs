#!/usr/bin/env node
/**
 * Goal diff verifier: asserts that every commit in BASELINE..HEAD satisfies
 * this goal's scope contract.
 *
 * Checks:
 * 1. BASELINE exists and is an ancestor of HEAD.
 * 2. The range is nonempty and linear (no merge commits).
 * 3. Every changed path of every commit (deletions and renames included)
 *    falls inside the allowed maintained-source / generated-artifact set.
 * 4. package.json is byte-identical to BASELINE (public exports map unchanged).
 *
 * Exit codes: 0 = pass, 1 = contract violation, 2 = usage/environment error.
 */
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function git(...args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" })
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

const baseline = process.argv[2]
if (!baseline) {
  console.error("usage: node script/verify-goal-diff.mjs <BASELINE_SHA>")
  process.exit(2)
}

// Allowed changed paths (posix-style, prefix match).
const allowedPrefixes = [
  "src/",
  "solid/source/",
  "solid/src/",
  "spinner/src/",
  "chart/src/",
  "test/",
  "script/",
  // Generated runtime/declaration artifacts (see AGENTS.md project map).
  "lib/",
  "renderables/",
  "platform/",
  "plugins/",
  "testing/",
  "spinner/dist/",
  "chart/dist/",
  "renderer-artifacts.json",
]

const allowedRootFiles = [/^index-[^/]*\.js$/, /^index\.js$/, /\.d\.ts$/, /^testing\.js$/, /^yoga\.js$/]

// Maintained root JS/declaration artifacts are the only root-level files that
// may change; everything else at the repo root is out of scope.
function isAllowedPath(filePath) {
  if (allowedPrefixes.some((prefix) => filePath.startsWith(prefix))) return true
  if (!filePath.includes("/")) return allowedRootFiles.some((pattern) => pattern.test(filePath))
  return false
}

// 1. BASELINE ancestry.
try {
  git("cat-file", "-e", `${baseline}^{commit}`)
} catch {
  fail(`baseline ${baseline} does not resolve to a commit`)
}
try {
  git("merge-base", "--is-ancestor", baseline, "HEAD")
} catch {
  fail(`baseline ${baseline} is not an ancestor of HEAD`)
}

// 2. Nonempty linear range.
const commits = git("rev-list", `${baseline}..HEAD`).split("\n").filter(Boolean)
if (commits.length === 0) fail(`range ${baseline}..HEAD is empty`)
const merges = git("rev-list", "--merges", `${baseline}..HEAD`).trim()
if (merges) fail(`range contains merge commits:\n${merges}`)
console.log(`range ${baseline.slice(0, 8)}..HEAD: ${commits.length} linear commit(s)`)

// 3. Per-commit changed-path enumeration.
const violations = []
for (const commit of commits) {
  const subject = git("log", "-1", "--format=%s", commit).trim()
  const nameStatus = git("diff-tree", "--no-commit-id", "--name-status", "-r", "-M", commit)
  const entries = nameStatus.split("\n").filter(Boolean)

  for (const entry of entries) {
    const [status, from, to] = entry.split("\t")
    const paths = status.startsWith("R") ? [from, to] : [from ?? to]
    for (const changedPath of paths.filter(Boolean)) {
      if (!isAllowedPath(changedPath)) {
        violations.push(`${commit.slice(0, 8)} (${subject}): ${status} ${changedPath}`)
      }
    }
  }
}

if (violations.length > 0) {
  fail(`${violations.length} changed path(s) outside the allowed scope:\n${violations.map((v) => `  - ${v}`).join("\n")}`)
}
console.log("changed-path policy: all paths within allowed scope")

// 4. Package manifest unchanged.
for (const file of ["package.json"]) {
  const diff = git("diff", `${baseline}..HEAD`, "--", file).trim()
  if (diff) fail(`${file} changed since baseline (public exports must stay untouched)`)
}
console.log("package.json unchanged since baseline")

console.log(`PASS: ${commits.length} commit(s) satisfy the goal diff contract`)
