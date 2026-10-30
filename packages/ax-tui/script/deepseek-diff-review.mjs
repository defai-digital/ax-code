#!/usr/bin/env node
/**
 * DeepSeek diff review gate: runs the final BASELINE..HEAD diff past a
 * headless deepseek CLI and asserts an explicit verdict.
 *
 * Contract:
 * - The CLI is located on PATH or in common install dirs. `DEEPSEEK_CLI`
 *   overrides the binary path. Absence fails loudly (exit 2).
 * - The review prompt is fully self-contained (diff inlined, tools
 *   disabled) and bounded in size.
 * - The child process runs under a hard timeout (default 600s,
 *   `DEEPSEEK_REVIEW_TIMEOUT_MS` overrides) and is killed on expiry (exit 3).
 * - A zero exit code without an explicit `FINDINGS` / `NO-FINDINGS` verdict
 *   is a failure (exit 4).
 *
 * CLI invocation contract: the prompt is piped on STDIN with tool flags
 * disabled (`--no-tools` when the CLI understands it; `DEEPSEEK_REVIEW_ARGS`
 * overrides the extra argument list wholesale).
 *
 * Exit codes: 0 = verdict captured, 1 = FINDINGS reported (gate signal for
 * the caller to triage), 2 = CLI not found, 3 = timeout, 4 = no verdict.
 */
import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const MAX_DIFF_CHARS = 96_000
const MAX_STDOUT_CHARS = 400_000

function fail(exitCode, message) {
  console.error(`FAIL: ${message}`)
  process.exit(exitCode)
}

const baseline = process.argv[2]
if (!baseline) {
  console.error("usage: node script/deepseek-diff-review.mjs <BASELINE_SHA>")
  process.exit(2)
}

function git(...args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" })
}

// --- 1. Locate the deepseek CLI. -------------------------------------------
const candidates = []
if (process.env.DEEPSEEK_CLI) {
  candidates.push(process.env.DEEPSEEK_CLI)
}
for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
  if (dir) candidates.push(path.join(dir, "deepseek"))
}
const home = homedir()
for (const dir of [
  path.join(home, ".local", "bin"),
  path.join(home, ".cargo", "bin"),
  path.join(home, ".bun", "bin"),
  path.join(home, ".deno", "bin"),
  path.join(home, "bin"),
  path.join(home, ".deepseek"),
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/bin",
]) {
  candidates.push(path.join(dir, "deepseek"), path.join(dir, "deepseek-cli"))
}

const cliPath = candidates.find((candidate) => {
  try {
    return existsSync(candidate)
  } catch {
    return false
  }
})
if (!cliPath) {
  fail(
    2,
    "deepseek CLI not found on PATH or in common install dirs " +
      "(set DEEPSEEK_CLI to the binary path to point the gate at it)",
  )
}
console.log(`deepseek CLI found: ${cliPath}`)

// --- 2. Build the bounded self-contained review prompt. --------------------
git("cat-file", "-e", `${baseline}^{commit}`) // throws (and aborts) on a bad SHA
const stat = git("diff", "--stat", `${baseline}..HEAD`).trim()
// Review the refactored renderer sources: regenerated bundles dominate the
// raw diff (tens of thousands of lines) while their freshness is already
// proven by `pnpm run check`, and the added tests/scripts are executed by
// the other gates. Their per-file stats stay in the prompt for context.
const maintainedPaths = ["src"]
let diff = git("diff", `${baseline}..HEAD`, "--", ...maintainedPaths)
if (diff.length > MAX_DIFF_CHARS) {
  const truncatedAt = diff.lastIndexOf("\ndiff --git", MAX_DIFF_CHARS)
  const cut = truncatedAt > 0 ? truncatedAt : MAX_DIFF_CHARS
  diff = `${diff.slice(0, cut)}\n\n[DIFF TRUNCATED AT ${cut} OF ${diff.length} CHARS]`
}
const prompt = [
  "You are reviewing a TypeScript terminal-UI framework diff for a refactor goal:",
  "duplicate-code consolidation, boundary/stability hardening (NaN, empty,",
  "out-of-range inputs), behavior parity, and no new public exports.",
  "Do NOT use any tools: every fact you need is in the diff text below.",
  "Report each real defect as a bullet with file path and short rationale.",
  "Do not report style nits or hypothetical concerns.",
  "End your response with exactly one line:",
  "  VERDICT: NO-FINDINGS   (when there is nothing actionable)",
  "  VERDICT: FINDINGS      (when at least one actionable defect exists)",
  "",
  "=== COMMIT RANGE SUMMARY (all paths, incl. regenerated artifacts) ===",
  stat,
  "",
  "=== UNIFIED DIFF (maintained sources; regenerated artifacts omitted) ===",
  diff,
].join("\n")

// --- 3. Run the CLI under a hard timeout. ----------------------------------
const timeoutMs = Number(process.env.DEEPSEEK_REVIEW_TIMEOUT_MS ?? 600_000)
const extraArgs = process.env.DEEPSEEK_REVIEW_ARGS ? process.env.DEEPSEEK_REVIEW_ARGS.split(" ").filter(Boolean) : ["--no-tools"]
const child = spawn(cliPath, extraArgs, { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] })

// The CLI contract reads the prompt from STDIN; close the pipe so the CLI
// sees EOF once the prompt has been delivered.
child.stdin.on("error", () => {}) // EPIPE after an early CLI exit is fine
child.stdin.write(prompt)
child.stdin.end()

let stdout = ""
let stderr = ""
let killedByTimeout = false
child.stdout.on("data", (chunk) => {
  if (stdout.length < MAX_STDOUT_CHARS) stdout += chunk.toString()
})
child.stderr.on("data", (chunk) => {
  if (stderr.length < MAX_STDOUT_CHARS) stderr += chunk.toString()
})

const timer = setTimeout(() => {
  killedByTimeout = true
  child.kill("SIGTERM")
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
}, timeoutMs)

child.on("error", (error) => fail(2, `failed to launch deepseek CLI: ${error.message}`))

const exitCode = await new Promise((resolve) => {
  child.on("close", (code) => resolve(code))
})
clearTimeout(timer)

if (killedByTimeout) {
  fail(3, `deepseek review exceeded hard timeout of ${timeoutMs}ms and was killed`)
}
if (exitCode !== 0) {
  fail(2, `deepseek CLI exited with code ${exitCode}\nstderr: ${stderr.slice(-2_000)}`)
}

// --- 4. Assert an explicit verdict. ---------------------------------------
// The prompt itself shows both verdict strings, and reasoning may quote them;
// only the final occurrence is the actual verdict.
const verdictMatches = [...stdout.matchAll(/VERDICT:\s*(NO-?FINDINGS|FINDINGS)/gi)]
const verdictMatch = verdictMatches.at(-1)
if (!verdictMatch) {
  fail(4, `deepseek CLI exited 0 but no explicit FINDINGS/NO-FINDINGS verdict was found\noutput tail: ${stdout.slice(-2_000)}`)
}

const verdict = verdictMatch[1].toUpperCase().replace("NOFINDINGS", "NO-FINDINGS")
console.log("=== DEEPSEEK REVIEW OUTPUT ===")
console.log(stdout.trim())
if (verdict === "FINDINGS") {
  console.error("deepseek review reported FINDINGS — triage each item, then re-run")
  process.exit(1)
}
console.log(`PASS: deepseek review completed with ${verdict}`)
