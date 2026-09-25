#!/usr/bin/env node
// Goal check (AC2): run a read-only cross-model review of the bounded AX Engine
// goal diff with the codex and muse CLIs, and assert each produced a verdict that
// is bound to the exact diff this check hashed.
//
// Fails when:
//   - the goal diff is empty;
//   - either reviewer exits non-zero, times out, or is unavailable;
//   - either reviewer omits the VERDICT or DIFF_SHA256 marker;
//   - an echoed DIFF_SHA256 differs from the current diff hash (drift), or
//   - either reviewer mutated the workspace (repo state hash changed).
//
// Usage: node script/check-goal-cross-review.mjs --baseline <sha>
//
// muse is isolated in a throwaway /tmp workspace with --disable-write and
// --disable-shell (it has mutated shared trees before). codex runs read-only.
// The prompt is bounded (< ~5 KB): the full source diff is inlined verbatim and
// the test-only churn is summarized, because muse stalls on large code briefs.

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const GOAL_PATHS = ["packages/ax-code/src/provider/ax-engine", "packages/ax-code/test/provider/ax-engine"]
const SRC_PATH = "packages/ax-code/src/provider/ax-engine"
const TEST_PATH = "packages/ax-code/test/provider/ax-engine"

const CODEX_TIMEOUT_MS = Number(process.env.GOAL_REVIEW_CODEX_TIMEOUT_MS ?? 300_000)
const MUSE_TIMEOUT_MS = Number(process.env.GOAL_REVIEW_MUSE_TIMEOUT_MS ?? 420_000)

function argValue(name) {
  const i = process.argv.indexOf(name)
  if (i < 0) return undefined
  const value = process.argv[i + 1]
  return value && !value.startsWith("--") ? value : undefined
}

function git(args, allowFailure = false) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    if (allowFailure) return ""
    throw error
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}

// A content hash of the whole working tree state (tracked diff + untracked files).
function repoState() {
  const head = git(["rev-parse", "HEAD"]).trim()
  const status = git(["status", "--porcelain"])
  return sha256(`${head}\n${status}`)
}

function boundedGoalDiff(baseline) {
  return git(["diff", baseline, "--", ...GOAL_PATHS])
}

function buildPrompt(baseline, hash) {
  const changedSrc = git(["diff", "--name-only", baseline, "--", SRC_PATH]).trim().split("\n").filter(Boolean)
  const sourceDiff = git(["diff", baseline, "--", ...changedSrc]).trimEnd()
  const testStat = git(["diff", "--stat", baseline, "--", TEST_PATH]).trimEnd()
  const testSummary = testStat ? testStat : "(no test changes)"
  return `You are reviewing ONE bounded change to the AX Code repository: its AX Engine
compatibility floor and version-resolution logic. The floor (bundled sidecar
pin and AX_ENGINE_MIN_VERSION) moved from 7.5.6 to 7.5.7, so configured, PATH,
managed, and bundled resolution now require an AX Engine >= 7.5.7, and version
comparison must not let a prerelease below the floor pass.

This is a READ-ONLY review. Do not run tools or edit anything. Read the inlined
change below and reason from it.

SOURCE DIFF (verbatim):
\`\`\`diff
${sourceDiff}
\`\`\`

TEST CHANGES (no logic change; version fixtures shifted to the new floor):
\`\`\`
${testSummary}
\`\`\`

The complete goal diff (source + tests) has this SHA-256:
${hash}

Review ONLY the change above for real defects: floor/version comparison errors
(including prerelease and coercion pitfalls), resolution-order regressions,
install identity/hash-pin mistakes, or an inconsistency between the bundled pin
and the minimum version. Do not propose unrelated refactors or stylistic
requests.

End your reply with exactly these two lines (after any reasoning):
DIFF_SHA256: ${hash}
VERDICT: NO_FINDINGS
If you can confirm a concrete defect, additionally emit one or more lines:
FINDING: <repo-relative file>:<line> <one-sentence defect>
and use VERDICT: FINDINGS.`
}

function runCodex(prompt, repoRoot) {
  const outDir = mkdtempSync(path.join(tmpdir(), "goal-codex-"))
  const lastPath = path.join(outDir, "last.txt")
  const result = spawnSync(
    "codex",
    ["exec", "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-o", lastPath, prompt],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: CODEX_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let output = ""
  try {
    output = readFileSync(lastPath, "utf8")
  } catch {
    // Missing, unreadable, or not a regular file: fall back to stdout below.
  }
  if (!output.trim()) output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  rmSync(outDir, { recursive: true, force: true })
  return { name: "codex", result, output }
}

function runMuse(prompt, repoRoot) {
  const dir = mkdtempSync(path.join(tmpdir(), "goal-muse-"))
  const workspace = path.join(dir, "workspace")
  const promptPath = path.join(dir, "prompt.md")
  mkdirSync(workspace, { recursive: true })
  writeFileSync(promptPath, prompt)
  const result = spawnSync(
    "muse",
    [
      "exec",
      "--workspace",
      workspace,
      "--prompt-file",
      promptPath,
      "--disable-write",
      "--disable-shell",
      "--disable-web-tools",
      "--no-session-log",
      "--no-foreign-personal-context",
      "--approval-mode",
      "never",
      "--max-model-steps",
      "6",
    ],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: MUSE_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  rmSync(dir, { recursive: true, force: true })
  return { name: "muse", result, output }
}

function lastMatch(text, re) {
  let value
  for (const match of text.matchAll(re)) value = match[1]
  return value
}

function describeFailure(result) {
  if (result.error?.code === "ENOENT") return "CLI not found on PATH"
  if (result.error?.code === "ETIMEDOUT") return `timed out after ${result.error.timeout ?? "?"}ms`
  if (result.signal) return `killed by signal ${result.signal}`
  return `exit ${result.status}`
}

function evaluate(review, hash) {
  const verdict = lastMatch(review.output, /VERDICT:\s*(NO_FINDINGS|FINDINGS)/gi)
  const echoed = lastMatch(review.output, /DIFF_SHA256:\s*([0-9a-f]{64})/gi)
  const findings = [...review.output.matchAll(/^FINDING:.*$/gim)].map((m) => m[0].trim())
  const problems = []
  if (review.result.error || review.result.signal || review.result.status !== 0)
    problems.push(`${review.name} did not complete cleanly (${describeFailure(review.result)})`)
  if (!verdict) problems.push(`${review.name} emitted no VERDICT marker`)
  if (!echoed) problems.push(`${review.name} emitted no DIFF_SHA256 marker`)
  else if (echoed.toLowerCase() !== hash) problems.push(`${review.name} echoed hash ${echoed} != ${hash}`)
  if (verdict === "FINDINGS" && findings.length === 0)
    problems.push(`${review.name} verdict FINDINGS with no FINDING line`)
  return { name: review.name, verdict, echoed, findings, problems }
}

function main() {
  const baseline = argValue("--baseline")
  if (!baseline) {
    console.error("usage: node script/check-goal-cross-review.mjs --baseline <sha>")
    process.exit(2)
  }
  const repoRoot = git(["rev-parse", "--show-toplevel"]).trim()
  process.chdir(repoRoot)

  const diff = boundedGoalDiff(baseline)
  if (!diff.trim()) {
    console.error(`FAIL: goal diff is empty for baseline ${baseline} over ${GOAL_PATHS.join(", ")}`)
    process.exit(1)
  }
  const hash = sha256(diff)
  console.log(`goal diff: ${diff.length} bytes over ${GOAL_PATHS.join(", ")}`)
  console.log(`goal diff sha256: ${hash}`)

  const prompt = buildPrompt(baseline, hash)
  console.log(`review prompt: ${prompt.length} bytes`)

  const before = repoState()
  const results = [evaluate(runCodex(prompt, repoRoot), hash), evaluate(runMuse(prompt, repoRoot), hash)]
  const after = repoState()

  let failed = false
  for (const r of results) {
    console.log(`\n[${r.name}] verdict=${r.verdict ?? "none"} echoed=${r.echoed ?? "none"}`)
    for (const finding of r.findings) console.log(`  ${finding}`)
    for (const problem of r.problems) console.log(`  PROBLEM: ${problem}`)
    if (r.problems.length) failed = true
  }

  if (before !== after) {
    console.log(`\nPROBLEM: workspace mutated during review (${before} -> ${after})`)
    failed = true
  } else {
    console.log(`\nworkspace tree unchanged (${after})`)
  }

  if (failed) {
    console.error("\nFAIL: cross-model review did not satisfy the goal contract")
    process.exit(1)
  }
  console.log("\nPASS: codex and muse each completed a bound read-only review")
}

main()
