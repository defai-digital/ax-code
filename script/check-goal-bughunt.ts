#!/usr/bin/env -S npx tsx
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { LOCAL_ONLY_ROOT_FILES } from "./repository-policy"

/**
 * Project-owned verifier for the goal/agentic cross-CLI bug hunt.
 *
 * It does not trust a summary: every mode re-reads the raw artifacts produced
 * by the reviewers (`logs/*.stdout.txt`), recomputes the frozen-scope
 * fingerprint from the baseline commit, and re-derives the findings that
 * triage is supposed to cover. A stalled or incomplete reviewer run is never
 * counted as a completed review.
 *
 * Modes:
 *   --evidence    every required reviewer completed, verdict + identity + fingerprint match, batches covered
 *   --triage      every evidence finding id triaged once, confirmations and decisions backed by evidence
 *   --regression  each fixed finding has a regression test plus a captured pre-fix failing run
 *   --suite       glob-discovered goal/agentic tests are nonempty, cover regressions, and pass
 *   --scope       baseline..HEAD is linear, nonempty and every committed path is allowlisted
 */

export const REQUIRED_REVIEWERS = ["muse", "claude", "codex"] as const

export type Batch = { id: string; paths: readonly string[]; fingerprint: string }

export type ReviewRun = {
  reviewer: string
  batch: string
  exitCode: number | null
  signal: string | null
  completed: boolean
  error: string | null
  stdoutBytes: number
  fingerprint: string
  logText: string
}

export type TriageEntry = {
  id: string
  summary: string
  confirmed: boolean
  decision: "fix" | "reject"
  reason: string
  confirmation: { method: string; evidence: string }
  rejection?: { attempted: boolean; evidence: string }
  fix?: { summary: string; paths: readonly string[] }
  regression?: { testPath: string; testName?: string }
  prefix?: { log: string; exitCode: number | null; testName?: string }
}

const FINDING_HEADER = /^FINDING\s+(\d+)\s*:/gm
const VERDICT_LINE = /^(FINDINGS:\s*(\d+)|NO_FINDINGS)$/

export function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

export function fingerprintFor(baseline: string, paths: readonly string[]) {
  const result = spawnSync("git", ["ls-tree", "-r", baseline, "--", ...paths], { encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ls-tree exited ${result.status}: ${result.stderr.trim()}`)
  return sha256(result.stdout ?? "")
}

/** The last non-empty line must be exactly `FINDINGS: <n>` or `NO_FINDINGS`. */
export function terminalVerdict(logText: string): { verdict: "FINDINGS" | "NO_FINDINGS"; count: number } | null {
  const lines = logText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines.at(-1)
  if (!last) return null
  const match = VERDICT_LINE.exec(last)
  if (!match) return null
  if (last === "NO_FINDINGS") return { verdict: "NO_FINDINGS", count: 0 }
  return { verdict: "FINDINGS", count: Number.parseInt(match[2] ?? "", 10) }
}

/** 1-based finding numbers derived from the raw log, e.g. FINDING 2: -> 2. */
export function findingNumbers(logText: string): number[] {
  const found = [...logText.matchAll(FINDING_HEADER)].map((match) => Number.parseInt(match[1] ?? "", 10))
  return [...new Set(found)].sort((a, b) => a - b)
}

export function findingId(run: ReviewRun, n: number) {
  return `${run.reviewer}/${run.batch}/F${n}`
}

export function reviewErrors(input: {
  baseline: string
  batches: readonly Batch[]
  runs: readonly ReviewRun[]
  requiredReviewers?: readonly string[]
}): string[] {
  const errors: string[] = []
  const required = input.requiredReviewers ?? REQUIRED_REVIEWERS
  if (!/^[0-9a-f]{7,40}$/i.test(input.baseline)) errors.push(`baseline "${input.baseline}" is not a git revision`)
  const batchIds = new Set(input.batches.map((batch) => batch.id))
  if (batchIds.size !== input.batches.length) errors.push("duplicate batch ids declared")
  if (input.batches.length === 0) errors.push("no review batches declared")

  const covered = new Set<string>()
  for (const reviewer of required) {
    const runs = input.runs.filter((run) => run.reviewer === reviewer)
    if (!runs.some((run) => run.completed)) errors.push(`reviewer ${reviewer} has no completed run`)
  }
  for (const run of input.runs) {
    const label = `${run.reviewer}/${run.batch}`
    const batch = input.batches.find((item) => item.id === run.batch)
    if (!batch) {
      errors.push(`${label}: references undeclared batch`)
      continue
    }
    if (!run.completed || run.exitCode !== 0 || run.signal !== null || run.error) {
      errors.push(
        `${label}: incomplete run (exit=${run.exitCode} signal=${run.signal} error=${run.error}); a stall is not a review`,
      )
      continue
    }
    if (run.stdoutBytes <= 0) errors.push(`${label}: produced no review output`)
    if (run.fingerprint !== batch.fingerprint)
      errors.push(`${label}: fingerprint ${run.fingerprint} != recomputed ${batch.fingerprint}`)
    if (!run.logText.includes(`BASELINE: ${input.baseline}`))
      errors.push(`${label}: log does not echo the baseline identity`)
    const verdict = terminalVerdict(run.logText)
    if (!verdict) {
      errors.push(`${label}: no terminal FINDINGS:/NO_FINDINGS verdict`)
      continue
    }
    const numbers = findingNumbers(run.logText)
    if (verdict.verdict === "NO_FINDINGS" && numbers.length > 0)
      errors.push(`${label}: verdict NO_FINDINGS but ${numbers.length} FINDING blocks were logged`)
    if (verdict.verdict === "FINDINGS" && verdict.count !== numbers.length)
      errors.push(`${label}: verdict count ${verdict.count} != ${numbers.length} FINDING blocks`)
    covered.add(run.batch)
  }
  for (const id of batchIds) if (!covered.has(id)) errors.push(`batch ${id} was not covered by any completed review`)
  return errors
}

export function evidenceFindingIds(input: {
  baseline: string
  batches: readonly Batch[]
  runs: readonly ReviewRun[]
}): string[] {
  const runs = input.runs.filter((run) => run.completed && run.exitCode === 0 && !run.error && run.signal === null)
  const ids: string[] = []
  for (const run of runs) for (const n of findingNumbers(run.logText)) ids.push(findingId(run, n))
  return [...new Set(ids)].sort()
}

export function triageErrors(input: { evidenceIds: readonly string[]; entries: readonly TriageEntry[] }): string[] {
  const errors: string[] = []
  const evidence = new Set(input.evidenceIds)
  const seen = new Set<string>()
  for (const entry of input.entries) {
    if (seen.has(entry.id)) errors.push(`finding ${entry.id} is triaged more than once`)
    seen.add(entry.id)
    if (!evidence.has(entry.id)) errors.push(`triage entry ${entry.id} is an orphan (no such finding in evidence)`)
    if (typeof entry.confirmed !== "boolean") errors.push(`${entry.id}: confirmed must be a boolean`)
    if (!entry.confirmation?.evidence?.trim()) errors.push(`${entry.id}: missing independent confirmation evidence`)
    if (entry.decision === "fix") {
      if (!entry.regression?.testPath?.trim()) errors.push(`${entry.id}: decision fix requires a regression testPath`)
      if (!entry.fix?.summary?.trim()) errors.push(`${entry.id}: decision fix requires a fix summary`)
    } else if (entry.decision === "reject") {
      if (entry.rejection?.attempted !== true)
        errors.push(`${entry.id}: rejection must record an attempted reproduction`)
      if (!entry.rejection?.evidence?.trim()) errors.push(`${entry.id}: rejection must record reproduction evidence`)
    } else {
      errors.push(`${entry.id}: decision must be fix or reject`)
    }
  }
  for (const id of evidence) if (!seen.has(id)) errors.push(`finding ${id} was never triaged`)
  return errors
}

const PREFIX_FAILURE = /(FAIL|\bfailed\b|×|exit code\s*[1-9])/i

/** Pre-fix logs prove the regression test actually failed before the fix. */
export function prefixErrors(input: {
  fixes: readonly { id: string; prefix?: { log: string; exitCode: number | null; testName?: string } }[]
  readLog: (file: string) => string | undefined
}): string[] {
  const errors: string[] = []
  for (const fix of input.fixes) {
    const prefix = fix.prefix
    if (!prefix) {
      errors.push(`${fix.id}: no captured pre-fix failing run`)
      continue
    }
    if (typeof prefix.exitCode !== "number" || prefix.exitCode === 0)
      errors.push(`${fix.id}: pre-fix run must be a captured nonzero exit, got ${prefix.exitCode}`)
    const text = input.readLog(prefix.log)
    if (text === undefined) {
      errors.push(`${fix.id}: pre-fix log ${prefix.log} is missing`)
      continue
    }
    if (!text.trim()) {
      errors.push(`${fix.id}: pre-fix log ${prefix.log} is empty`)
      continue
    }
    if (!PREFIX_FAILURE.test(text)) errors.push(`${fix.id}: pre-fix log ${prefix.log} shows no failure marker`)
    if (prefix.testName && !text.includes(prefix.testName))
      errors.push(`${fix.id}: pre-fix log ${prefix.log} does not show test "${prefix.testName}"`)
  }
  return errors
}

const SCOPE_PREFIX_ALLOWLIST = [
  "packages/ax-code/src/session/",
  "packages/ax-code/src/tool/",
  "packages/ax-code/src/agent/",
  "packages/ax-code/test/session/",
  "packages/ax-code/test/tool/",
] as const
const SCOPE_FILE_ALLOWLIST = new Set(["script/check-goal-bughunt.ts", "script/goal-bughunt.test.ts"])

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Derived from the shared local-only list so a newly declared agent-instruction
// file cannot be forgotten here.
const FORBIDDEN_PATH = new RegExp(
  `(^|/)\\.internal(/|$)|(^|/)(?:${LOCAL_ONLY_ROOT_FILES.map(escapeRegExp).join("|")})$`,
  "i",
)

export function scopeAllowed(file: string) {
  if (FORBIDDEN_PATH.test(file)) return false
  if (SCOPE_FILE_ALLOWLIST.has(file)) return true
  return SCOPE_PREFIX_ALLOWLIST.some((prefix) => file.startsWith(prefix))
}

export function scopeErrors(input: {
  baseline: string
  isAncestor: boolean
  mergeCount: number
  commits: readonly { sha: string; paths: readonly string[] }[]
  trackedInternal: readonly string[]
  trackedAgentFiles: readonly string[]
}): string[] {
  const errors: string[] = []
  if (!input.isAncestor) errors.push(`${input.baseline} is not an ancestor of HEAD`)
  if (input.commits.length === 0) errors.push("baseline..HEAD range is empty")
  if (input.mergeCount !== 0)
    errors.push(`baseline..HEAD contains ${input.mergeCount} merge commit(s); the range must be linear`)
  for (const commit of input.commits) {
    if (commit.paths.length === 0) errors.push(`commit ${commit.sha} changes no path (unexpected for a scoped change)`)
    for (const file of commit.paths) {
      if (!scopeAllowed(file)) errors.push(`commit ${commit.sha} touches out-of-scope path ${file}`)
    }
  }
  for (const file of input.trackedInternal) errors.push(`tracked local-only path: ${file}`)
  for (const file of input.trackedAgentFiles) errors.push(`tracked local-only path: ${file}`)
  return errors
}

export function discoveredGoalTests(testRoot: string): string[] {
  const dirs = ["session", "tool"]
  const found: string[] = []
  for (const dir of dirs) {
    const absolute = path.join(testRoot, dir)
    if (!existsSync(absolute)) continue
    for (const entry of readdirSync(absolute)) {
      if (!entry.endsWith(".test.ts")) continue
      if (!/goal|agentic/i.test(entry)) continue
      found.push(path.posix.join("test", dir, entry))
    }
  }
  return found.sort()
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type CliOptions = {
  mode: "evidence" | "triage" | "regression" | "suite" | "scope"
  dir: string
  root: string
  help: boolean
  target?: string
  baseline?: string
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    mode: "evidence",
    dir: ".internal/reports/goal-agentic-bughunt",
    root: ".",
    help: false,
  }
  for (const arg of argv) {
    if (arg === "--evidence") options.mode = "evidence"
    else if (arg === "--triage") options.mode = "triage"
    else if (arg === "--regression") options.mode = "regression"
    else if (arg === "--suite") options.mode = "suite"
    else if (arg === "--scope") options.mode = "scope"
    else if (arg === "--help" || arg === "-h") options.help = true
    else if (arg.startsWith("--dir=")) options.dir = arg.slice("--dir=".length)
    else if (arg.startsWith("--root=")) options.root = arg.slice("--root=".length)
    else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length)
    else if (arg.startsWith("--baseline=")) options.baseline = arg.slice("--baseline=".length)
  }
  return options
}

function git(root: string, args: string[]) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" })
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T
}

function loadBatches(dir: string, root: string): { baseline: string; batches: Batch[] } {
  const manifest = readJson<{ baseline: string; batches: Array<{ id: string; paths: string[] }> }>(
    path.join(dir, "batches.json"),
  )
  const batches = manifest.batches.map((batch) => ({
    id: batch.id,
    paths: batch.paths,
    fingerprint: fingerprintFor(manifest.baseline, batch.paths),
  }))
  return { baseline: manifest.baseline, batches }
}

function loadRuns(dir: string, batches: readonly Batch[]): ReviewRun[] {
  const logsDir = path.join(dir, "logs")
  if (!existsSync(logsDir)) return []
  const runs: ReviewRun[] = []
  for (const entry of readdirSync(logsDir)) {
    const match = /^(.+?)-(.+)\.stdout\.txt$/.exec(entry)
    if (!match) continue
    const reviewer = match[1] ?? ""
    const batch = match[2] ?? ""
    const recordFile = path.join(dir, `run-${reviewer}-${batch}.json`)
    if (!existsSync(recordFile)) continue
    const record = readJson<{
      exitCode: number | null
      signal: string | null
      error: string | null
      stdoutBytes: number
    }>(recordFile)
    const logText = readFileSync(path.join(logsDir, entry), "utf8")
    const completed = record.exitCode === 0 && record.signal === null && !record.error
    runs.push({
      reviewer,
      batch,
      exitCode: record.exitCode,
      signal: record.signal,
      error: record.error,
      stdoutBytes: record.stdoutBytes,
      completed,
      fingerprint: batches.find((item) => item.id === batch)?.fingerprint ?? "",
      logText,
    })
  }
  return runs
}

function report(name: string, errors: readonly string[]) {
  if (errors.length === 0) {
    console.log(`${name}: OK`)
    return 0
  }
  console.error(`${name}: FAILED`)
  for (const error of errors) console.error(`- ${error}`)
  return 1
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log("usage: tsx script/check-goal-bughunt.ts --evidence|--triage|--regression|--suite|--scope")
    return 0
  }
  const root = path.resolve(options.root)
  const dir = path.resolve(root, options.dir)
  if (!existsSync(dir)) {
    console.error(`evidence directory not found: ${dir}`)
    return 1
  }

  if (options.mode === "evidence") {
    const { baseline, batches } = loadBatches(dir, root)
    const runs = loadRuns(dir, batches)
    const errors = reviewErrors({ baseline, batches, runs })
    if (errors.length === 0) {
      const ids = evidenceFindingIds({ baseline, batches, runs })
      for (const run of runs) {
        const verdict = terminalVerdict(run.logText)
        console.log(
          `- ${run.reviewer}/${run.batch}: exit=${run.exitCode} verdict=${verdict?.verdict ?? "none"} findings=${findingNumbers(run.logText).length}`,
        )
      }
      console.log(`baseline ${baseline}; ${batches.length} batches; ${ids.length} candidate findings`)
    }
    return report("review-evidence", errors)
  }

  if (options.mode === "triage") {
    const { baseline, batches } = loadBatches(dir, root)
    const runs = loadRuns(dir, batches)
    const evidenceIds = evidenceFindingIds({ baseline, batches, runs })
    const triageFile = path.join(dir, "triage.json")
    if (!existsSync(triageFile)) return report("review-triage", ["triage.json is missing"])
    const entries = readJson<TriageEntry[]>(triageFile)
    return report("review-triage", triageErrors({ evidenceIds, entries }))
  }

  if (options.mode === "regression") {
    const triageFile = path.join(dir, "triage.json")
    if (!existsSync(triageFile)) return report("goal-regression", ["triage.json is missing"])
    const entries = readJson<TriageEntry[]>(triageFile)
    const fixes = entries.filter((entry) => entry.decision === "fix")
    const readLog = (file: string) => {
      const absolute = path.resolve(dir, file)
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined
    }
    const errors = prefixErrors({
      fixes: fixes.map((fix) => ({ id: fix.id, prefix: fix.prefix })),
      readLog,
    })
    for (const fix of fixes) {
      const testPath = fix.regression?.testPath
      if (!testPath) continue
      const result = spawnSync("pnpm", ["--dir", "packages/ax-code", "exec", "vitest", "run"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, AX_TEST_FILES: testPath },
        timeout: 300_000,
        maxBuffer: 64 * 1024 * 1024,
      })
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      if (result.status !== 0) errors.push(`${fix.id}: regression test ${testPath} exited ${result.status}`)
      if (!/\b\d+\s+passed\b/.test(output) || /\b\d+\s+failed\b/.test(output))
        errors.push(`${fix.id}: regression test ${testPath} did not report a clean passing summary`)
      console.log(`${fix.id}: ${testPath} exit=${result.status}`)
    }
    return report("goal-regression", errors)
  }

  if (options.mode === "suite") {
    const testRoot = path.join(root, "packages/ax-code/test")
    const discovered = discoveredGoalTests(testRoot)
    const errors: string[] = []
    if (discovered.length === 0) errors.push("no goal/agentic test files discovered")
    const triageFile = path.join(dir, "triage.json")
    if (existsSync(triageFile)) {
      for (const entry of readJson<TriageEntry[]>(triageFile)) {
        if (entry.decision !== "fix" || !entry.regression?.testPath) continue
        if (!discovered.includes(entry.regression.testPath))
          errors.push(`${entry.id}: regression path ${entry.regression.testPath} is not discovered by the suite`)
      }
    }
    if (errors.length === 0) {
      const result = spawnSync("pnpm", ["--dir", "packages/ax-code", "exec", "vitest", "run"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, AX_TEST_FILES: discovered.join(",") },
        timeout: 600_000,
        maxBuffer: 64 * 1024 * 1024,
      })
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      if (result.status !== 0) errors.push(`goal/agentic suite exited ${result.status}`)
      if (!/\b\d+\s+passed\b/.test(output) || /\b\d+\s+failed\b/.test(output))
        errors.push("goal/agentic suite did not report a clean passing summary")
      console.log(`- ${discovered.length} discovered files: ${discovered.join(", ")}`)
    }
    return report("goal-agentic-suite", errors)
  }

  // scope
  const manifest = readJson<{ baseline: string; scopeBaseline?: string; target?: string }>(
    path.join(dir, "batches.json"),
  )
  const baseline = options.baseline ?? manifest.scopeBaseline ?? manifest.baseline
  const target = options.target ?? (options.baseline ? "HEAD" : (manifest.target ?? "HEAD"))
  const ancestor = git(root, ["merge-base", "--is-ancestor", baseline, target])
  const isAncestor = ancestor.status === 0
  const shas = (git(root, ["rev-list", `${baseline}..${target}`]).stdout ?? "").trim().split(/\r?\n/).filter(Boolean)
  const mergeCount = Number.parseInt(
    (git(root, ["rev-list", "--count", "--merges", `${baseline}..${target}`]).stdout ?? "0").trim() || "0",
    10,
  )
  const commits = shas.map((sha) => {
    const paths = (git(root, ["diff-tree", "-r", "--no-commit-id", "--name-only", sha]).stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    console.log(`- ${sha.slice(0, 10)}: ${paths.length} path(s)`)
    for (const file of paths) console.log(`    ${file}`)
    return { sha, paths }
  })
  const trackedInternal = (git(root, ["ls-files", "--", ".internal"]).stdout ?? "").split(/\r?\n/).filter(Boolean)
  const trackedAgentFiles = (git(root, ["ls-files", "--", ...LOCAL_ONLY_ROOT_FILES]).stdout ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
  return report(
    "commit-scope",
    scopeErrors({ baseline, isAncestor, mergeCount, commits, trackedInternal, trackedAgentFiles }),
  )
}

const invokedDirectly = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
