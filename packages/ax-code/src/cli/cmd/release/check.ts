/**
 * `ax-code release check` — validate release-critical conditions before tagging.
 *
 * Implements Phase 1 of the debugging-capability plan. See
 * .internal/prd/PRD-2026-04-13-release-readiness-check.md for rationale.
 *
 * Each check is a pure async function that returns `CheckResult`. Checks are
 * ordered fail-fast-cheap-first so the user sees feedback quickly. No side
 * effects beyond reading the repo and spawning git/bun subprocesses.
 */

import path from "node:path"
import { readFile, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import semver from "semver"
import { cmd } from "../cmd"
import { git } from "../../../util/git"
import { Process } from "../../../util/process"
import { Filesystem } from "../../../util/filesystem"

// ───── public types (narrow for external consumption) ─────────────

/**
 * Minimal result surface for external callers (tests, scripts). The full
 * surface used by the CLI renderer is `CheckResult` below — a superset of this.
 */
export type ReleaseCheckStatus = "pass" | "fail"

export type ReleaseCheckResult = {
  name: string
  status: ReleaseCheckStatus
  details?: string
}

/**
 * Back-compat shim: the original 2-check API. Still used by external tests.
 * Validates only the parts that can be checked from a bare package.json and
 * does not spawn git or bun. For the full release check, use the yargs
 * `ax-code release check` command which runs `runChecks`.
 */
export async function releaseReadinessChecks(cwd: string): Promise<ReleaseCheckResult[]> {
  const pkg = await readAxCodePackageJSON(cwd)
  if (!pkg) {
    return [
      {
        name: "package.json",
        status: "fail",
        details: "could not find ax-code package.json from the current working directory",
      },
    ]
  }

  return [
    {
      name: "package name",
      status: pkg.name === "ax-code" ? "pass" : "fail",
      details: pkg.name ?? "missing name",
    },
    {
      name: "package version",
      status: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version ?? "") ? "pass" : "fail",
      details: pkg.version ?? "missing version",
    },
  ]
}

type PackageJSON = {
  name?: string
  version?: string
}

async function readAxCodePackageJSON(cwd: string): Promise<PackageJSON | undefined> {
  for (const candidate of packageJSONCandidates(cwd)) {
    const data = await readPackageJSON(candidate)
    if (data?.name === "ax-code") return data
  }
  return undefined
}

function packageJSONCandidates(cwd: string) {
  return [
    path.join(cwd, "package.json"),
    path.join(cwd, "packages", "ax-code", "package.json"),
    path.resolve(fileURLToPath(new URL("../../../../package.json", import.meta.url))),
  ]
}

async function readPackageJSON(file: string): Promise<PackageJSON | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as PackageJSON
  } catch {
    return undefined
  }
}

// ───── full check surface ─────────────────────────────────────────

export type CheckStatus = "ok" | "warn" | "fail" | "skip"

export interface CheckResult {
  name: string
  id: string
  status: CheckStatus
  detail: string
  remediation?: string
  durationMs: number
}

export interface CheckContext {
  /** Repository root. */
  repoRoot: string
  /** The version string under validation (from package.json or --version). */
  version: string
  /** Whether to run the (slow) deterministic test suite. */
  withTests: boolean
  /**
   * Whether branch-sync may `git fetch origin` to refresh the remote ref.
   * Default `false` so the check has no side effects. Pass `true` (via
   * `--fetch`) when you want fresh divergence info before tagging.
   */
  fetch: boolean
  /** Names of checks to skip. */
  skip: Set<string>
}

const AX_CODE_PKG = "packages/ax-code"

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now()
  const value = await fn()
  return [value, Date.now() - start]
}

function mkResult(
  name: string,
  id: string,
  status: CheckStatus,
  detail: string,
  durationMs: number,
  remediation?: string,
): CheckResult {
  return { name, id, status, detail, durationMs, remediation }
}

async function findRepoRoot(): Promise<string> {
  // Resolve from the user's actual shell cwd, not the CLI shim's internal cwd.
  // The ax-code bin launcher forces --cwd into packages/ax-code/ for bun
  // module resolution, so process.cwd() lies. callerCwd() reads
  // AX_CODE_ORIGINAL_CWD which the launcher sets before exec'ing bun run.
  // Fallback to process.cwd() when the env var isn't present (tests, SDK).
  const startCwd = Filesystem.callerCwd()
  const result = await git(["rev-parse", "--show-toplevel"], { cwd: startCwd })
  if (result.exitCode !== 0) {
    throw new Error("Not a git repository. Run `ax-code release check` from within ax-code.")
  }
  return result.text().trim()
}

async function readPackageVersion(repoRoot: string): Promise<string> {
  const pkgPath = path.join(repoRoot, AX_CODE_PKG, "package.json")
  const raw = await readFile(pkgPath, "utf8")
  const pkg = JSON.parse(raw) as { version?: string }
  if (!pkg.version) throw new Error(`Missing "version" in ${pkgPath}`)
  return pkg.version
}

/**
 * Returns the most recent stable tag on the same major line as `relativeTo`.
 * This matters in repos that release multiple major versions in parallel
 * (e.g. v2.x on `main` and v3.x on `beta`) — comparing a v2.x release
 * against v3.x's latest tag would report false regressions.
 *
 * If `relativeTo` is omitted, returns the overall latest semver tag.
 */
async function latestTag(repoRoot: string, relativeTo?: string): Promise<string | undefined> {
  const result = await git(["tag", "--sort=-v:refname", "--list", "v*"], { cwd: repoRoot })
  if (result.exitCode !== 0) return undefined
  const tags = result
    .text()
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const major = relativeTo && semver.valid(relativeTo) ? semver.major(relativeTo) : undefined
  for (const t of tags) {
    const v = t.replace(/^v/, "")
    if (!semver.valid(v)) continue
    if (semver.prerelease(v)) continue // skip beta/rc tags
    if (major !== undefined && semver.major(v) !== major) continue
    return t
  }
  // Fallback: if no same-major tag exists (e.g. first release on new major),
  // return the latest stable overall.
  if (major !== undefined) {
    for (const t of tags) {
      const v = t.replace(/^v/, "")
      if (semver.valid(v) && !semver.prerelease(v)) return t
    }
  }
  return undefined
}

// ───── individual checks ──────────────────────────────────────────

async function checkVersion(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    if (!semver.valid(ctx.version)) {
      return mkResult(
        "Version format",
        "version",
        "fail",
        `${ctx.version} is not valid semver`,
        0,
        `Edit ${AX_CODE_PKG}/package.json and set a valid semver.`,
      )
    }
    const prev = await latestTag(ctx.repoRoot, ctx.version)
    if (!prev) {
      return mkResult("Version format", "version", "ok", `${ctx.version} is valid semver (no prior tag)`, 0)
    }
    const prevVer = prev.replace(/^v/, "")
    if (!semver.gt(ctx.version, prevVer)) {
      return mkResult(
        "Version format",
        "version",
        "fail",
        `${ctx.version} is not greater than previous tag ${prev}`,
        0,
        `Bump the version in ${AX_CODE_PKG}/package.json above ${prevVer}.`,
      )
    }
    return mkResult("Version format", "version", "ok", `${ctx.version} is valid semver, greater than ${prev}`, 0)
  })
  return { ...r, durationMs }
}

/** Seconds to wait for a single network-bound git subprocess before giving up
 * with a warning. Long enough for slow networks, short enough to keep the
 * overall check under the PRD's 60s target. */
const NETWORK_TIMEOUT_MS = 10_000

async function gitWithTimeout(args: string[], cwd: string) {
  return Process.run(["git", ...args], {
    cwd,
    stdin: "ignore",
    nothrow: true,
    timeout: NETWORK_TIMEOUT_MS,
  }).catch((err: unknown) => ({
    code: 124, // conventional "timeout" exit code
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
  }))
}

async function checkRemoteTag(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    const tag = `v${ctx.version}`
    const res = await gitWithTimeout(["ls-remote", "--tags", "origin", tag], ctx.repoRoot)
    if (res.code !== 0) {
      return mkResult(
        "Remote tag",
        "remote-tag",
        "warn",
        `Could not query origin for ${tag} (${res.stderr.toString().trim() || "unknown error"})`,
        0,
        "Check network/auth. Not blocking, but re-run before pushing.",
      )
    }
    if (res.stdout.toString().includes(`refs/tags/${tag}`)) {
      return mkResult(
        "Remote tag",
        "remote-tag",
        "fail",
        `${tag} already exists on origin`,
        0,
        "Bump the version. Retagging a public release is destructive — see PRD.",
      )
    }
    return mkResult("Remote tag", "remote-tag", "ok", `${tag} does not exist on origin`, 0)
  })
  return { ...r, durationMs }
}

async function checkWorkingTree(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    const paths = [`${AX_CODE_PKG}/`, "script/", "crates/", ".github/workflows/"]
    const res = await git(["status", "--porcelain", "--", ...paths], { cwd: ctx.repoRoot })
    if (res.exitCode !== 0) {
      return mkResult("Working tree", "working-tree", "fail", "git status failed", 0, res.stderr.toString())
    }
    const lines = res
      .text()
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length === 0) {
      return mkResult("Working tree", "working-tree", "ok", "clean for release-critical paths", 0)
    }
    const preview = lines.slice(0, 5).join(", ")
    const more = lines.length > 5 ? ` (+${lines.length - 5} more)` : ""
    return mkResult(
      "Working tree",
      "working-tree",
      "fail",
      `${lines.length} uncommitted change(s): ${preview}${more}`,
      0,
      "Commit or stash the changes before releasing.",
    )
  })
  return { ...r, durationMs }
}

async function checkBranchSync(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    if (ctx.fetch) {
      // Side-effectful: updates origin/main ref. Gated behind --fetch per PRD
      // "validate, don't mutate" contract.
      const fetchRes = await gitWithTimeout(["fetch", "origin", "main", "--depth=10"], ctx.repoRoot)
      if (fetchRes.code !== 0) {
        return mkResult(
          "Branch sync",
          "branch-sync",
          "warn",
          `Could not fetch origin/main (${fetchRes.stderr.toString().trim() || "unknown error"})`,
          0,
          "Check network/auth.",
        )
      }
    }
    const counts = await git(["rev-list", "--left-right", "--count", "origin/main...HEAD"], {
      cwd: ctx.repoRoot,
    })
    if (counts.exitCode !== 0) {
      return mkResult(
        "Branch sync",
        "branch-sync",
        "warn",
        "Could not compute divergence from origin/main (is the branch tracked?)",
        0,
        ctx.fetch ? counts.stderr.toString() : "Try `ax-code release check --fetch` for a fresh check.",
      )
    }
    const parts = counts.text().trim().split(/\s+/)
    const behind = Number(parts[0])
    const ahead = Number(parts[1])
    if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
      return mkResult("Branch sync", "branch-sync", "warn", `unexpected rev-list output: ${counts.text().trim()}`, 0)
    }
    if (behind > 0) {
      return mkResult(
        "Branch sync",
        "branch-sync",
        "warn",
        `origin/main has ${behind} commit(s) you don't have locally`,
        0,
        "Run `git pull --ff-only` before tagging.",
      )
    }
    return mkResult("Branch sync", "branch-sync", "ok", `in sync (ahead by ${ahead})`, 0)
  })
  return { ...r, durationMs }
}

async function checkReleaseNotes(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    const notesPath = path.join(ctx.repoRoot, `.internal/release/release-notes-v${ctx.version}.md`)
    try {
      const s = await stat(notesPath)
      if (s.size < 50) {
        return mkResult(
          "Release notes",
          "release-notes",
          "warn",
          `${notesPath} exists but is suspiciously short (${s.size} bytes)`,
          0,
          "Flesh out the release notes.",
        )
      }
      return mkResult(
        "Release notes",
        "release-notes",
        "ok",
        `found at .internal/release/release-notes-v${ctx.version}.md`,
        0,
      )
    } catch {
      return mkResult(
        "Release notes",
        "release-notes",
        "warn",
        `no file at .internal/release/release-notes-v${ctx.version}.md`,
        0,
        "CI will auto-generate notes, but a curated file is recommended for minor+ releases.",
      )
    }
  })
  return { ...r, durationMs }
}

async function checkPhantomImports(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    // Scan: both src/ AND script/. The v2.21.2 failure — build.ts importing
    // an uncommitted ./models-snapshot — lived in script/, not src/. Scoping
    // scan to src/ alone would miss the exact bug class this check was
    // designed to catch. These two directories are the release-critical
    // TS surface; tests and benchmarks are excluded.
    const scanDirs = [
      path.join(ctx.repoRoot, AX_CODE_PKG, "src") + path.sep,
      path.join(ctx.repoRoot, AX_CODE_PKG, "script") + path.sep,
    ]
    // Resolve imports against *every* tracked file in the package (not just
    // src/ or script/), because source code legitimately imports files at
    // the package root (e.g. parsers-config.ts) and under assets/,
    // migration/, etc. Restricting the tracked set produced false-positive
    // phantom reports for any cross-directory import.
    const lsRes = await git(["ls-files", "--", `${AX_CODE_PKG}/`], { cwd: ctx.repoRoot })
    if (lsRes.exitCode !== 0) {
      return mkResult("Phantom imports", "phantom-imports", "fail", "git ls-files failed", 0, lsRes.stderr.toString())
    }
    const tracked = new Set(
      lsRes
        .text()
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((rel) => path.join(ctx.repoRoot, rel)),
    )
    const sourceFiles = [...tracked].filter((p) => scanDirs.some((d) => p.startsWith(d)) && /\.(ts|tsx)$/.test(p))
    const phantoms: { file: string; importPath: string; resolved: string }[] = []
    const importRe = /(?:^|\s)(?:import|export)\s+(?:[^'"`;]+?\s+from\s+)?['"](\.\.?\/[^'"`]+)['"]/g

    for (const file of sourceFiles) {
      const raw = await readFile(file, "utf8").catch(() => "")
      if (!raw) continue
      // Strip // line comments and /* block comments */ before scanning for
      // imports. Without this, a commented-out `// import { X } from "./foo"`
      // where `./foo` is untracked would report as a phantom. Shortcomings
      // of a naive strip (e.g. // inside a string literal) are acceptable
      // for a release-gate regex — we trade tiny false-negative risk for
      // a large false-positive reduction.
      const content = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
        .join("\n")
      const dir = path.dirname(file)
      let match: RegExpExecArray | null
      importRe.lastIndex = 0
      while ((match = importRe.exec(content))) {
        const raw = match[1]
        const candidates = [
          path.resolve(dir, raw),
          path.resolve(dir, raw + ".ts"),
          path.resolve(dir, raw + ".tsx"),
          path.resolve(dir, raw, "index.ts"),
          path.resolve(dir, raw, "index.tsx"),
          path.resolve(dir, raw + ".json"),
          path.resolve(dir, raw + ".txt"),
          path.resolve(dir, raw + ".sql"),
        ]
        if (candidates.some((c) => tracked.has(c))) continue
        // Not tracked — is it on disk? If yes, it's a phantom (untracked file).
        for (const c of candidates) {
          if (await Filesystem.exists(c)) {
            phantoms.push({
              file: path.relative(ctx.repoRoot, file),
              importPath: raw,
              resolved: path.relative(ctx.repoRoot, c),
            })
            break
          }
        }
      }
    }

    if (phantoms.length === 0) {
      return mkResult("Phantom imports", "phantom-imports", "ok", `scanned ${sourceFiles.length} files, no phantoms`, 0)
    }
    const preview = phantoms
      .slice(0, 3)
      .map((p) => `${p.file} -> ${p.importPath} (resolves to untracked ${p.resolved})`)
      .join("; ")
    const more = phantoms.length > 3 ? ` (+${phantoms.length - 3} more)` : ""
    return mkResult(
      "Phantom imports",
      "phantom-imports",
      "fail",
      `${phantoms.length} import(s) point to untracked files: ${preview}${more}`,
      0,
      "Commit the referenced files or remove the imports.",
    )
  })
  return { ...r, durationMs }
}

async function checkTypecheck(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    const res = await Process.run(["bun", "run", "typecheck"], {
      cwd: path.join(ctx.repoRoot, AX_CODE_PKG),
      stdin: "ignore",
      nothrow: true,
    }).catch((err: unknown) => ({
      code: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
    }))
    if (res.code === 0) {
      return mkResult("Typecheck", "typecheck", "ok", "passed", 0)
    }
    const combined = res.stderr.toString() + res.stdout.toString()
    const firstError = combined.split("\n").find((l) => l.includes("error")) ?? "see detail"
    return mkResult(
      "Typecheck",
      "typecheck",
      "fail",
      firstError.trim().slice(0, 200),
      0,
      "Run `pnpm --dir packages/ax-code run typecheck` for full output.",
    )
  })
  return { ...r, durationMs }
}

async function checkTests(ctx: CheckContext): Promise<CheckResult> {
  if (!ctx.withTests) {
    return mkResult("Tests", "tests", "skip", "skipped (pass --with-tests to run)", 0)
  }
  const [r, durationMs] = await timed(async () => {
    const res = await Process.run(["bun", "run", "test:ci", "--", "deterministic"], {
      cwd: path.join(ctx.repoRoot, AX_CODE_PKG),
      stdin: "ignore",
      nothrow: true,
    }).catch((err: unknown) => ({
      code: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
    }))
    if (res.code === 0) {
      return mkResult("Tests", "tests", "ok", "deterministic group passed", 0)
    }
    const failures = res.stdout
      .toString()
      .split("\n")
      .filter((l) => l.includes("(fail)")).length
    return mkResult(
      "Tests",
      "tests",
      "fail",
      `deterministic group failed (${failures} failure(s) detected)`,
      0,
      "Run `pnpm --dir packages/ax-code run test:ci -- deterministic` for details.",
    )
  })
  return { ...r, durationMs }
}

async function checkCommitsSinceRelease(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    const prev = await latestTag(ctx.repoRoot, ctx.version)
    if (!prev) {
      return mkResult("Commits since last release", "commits", "ok", "no prior tag to compare", 0)
    }
    const res = await git(["log", "--oneline", `${prev}..HEAD`], { cwd: ctx.repoRoot })
    if (res.exitCode !== 0) {
      return mkResult(
        "Commits since last release",
        "commits",
        "warn",
        `git log failed (${res.stderr.toString().trim() || "unknown error"})`,
        0,
      )
    }
    const commits = res
      .text()
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (commits.length === 0) {
      return mkResult(
        "Commits since last release",
        "commits",
        "warn",
        `no commits since ${prev}`,
        0,
        "Nothing to release. Did you mean to bump the version?",
      )
    }
    return mkResult("Commits since last release", "commits", "ok", `${commits.length} commit(s) since ${prev}`, 0)
  })
  return { ...r, durationMs }
}

async function checkWorkflowChanges(ctx: CheckContext): Promise<CheckResult> {
  const [r, durationMs] = await timed(async () => {
    const prev = await latestTag(ctx.repoRoot, ctx.version)
    if (!prev) {
      return mkResult("Workflow changes", "workflow-changes", "ok", "no prior tag; nothing to diff", 0)
    }
    const res = await git(["diff", "--name-only", prev, "HEAD", "--", ".github/workflows/"], {
      cwd: ctx.repoRoot,
    })
    if (res.exitCode !== 0) {
      return mkResult("Workflow changes", "workflow-changes", "warn", "git diff failed", 0, res.stderr.toString())
    }
    const files = res
      .text()
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (files.length === 0) {
      return mkResult("Workflow changes", "workflow-changes", "ok", "no workflow changes since last release", 0)
    }
    return mkResult(
      "Workflow changes",
      "workflow-changes",
      "warn",
      `${files.length} workflow file(s) changed: ${files.join(", ")}`,
      0,
      "Workflow diffs only run on CI. Consider a dry-run PR first.",
    )
  })
  return { ...r, durationMs }
}

// ───── runner + render ─────────────────────────────────────────────

const ALL_CHECKS: {
  id: string
  name: string
  run: (ctx: CheckContext) => Promise<CheckResult>
}[] = [
  { id: "version", name: "Version format", run: checkVersion },
  { id: "remote-tag", name: "Remote tag", run: checkRemoteTag },
  { id: "working-tree", name: "Working tree", run: checkWorkingTree },
  { id: "branch-sync", name: "Branch sync", run: checkBranchSync },
  { id: "release-notes", name: "Release notes", run: checkReleaseNotes },
  { id: "phantom-imports", name: "Phantom imports", run: checkPhantomImports },
  { id: "typecheck", name: "Typecheck", run: checkTypecheck },
  { id: "tests", name: "Tests", run: checkTests },
  { id: "commits", name: "Commits since last release", run: checkCommitsSinceRelease },
  { id: "workflow-changes", name: "Workflow changes", run: checkWorkflowChanges },
]

/** Valid ids accepted by `--skip`. Exported so tests and external scripts
 * can validate user input before invoking the runner. */
export const CHECK_IDS: readonly string[] = ALL_CHECKS.map((c) => c.id)

export async function runChecks(ctx: CheckContext): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const check of ALL_CHECKS) {
    if (ctx.skip.has(check.id)) {
      results.push({
        name: check.name,
        id: check.id,
        status: "skip",
        detail: `skipped via --skip ${check.id}`,
        durationMs: 0,
      })
      continue
    }
    results.push(await check.run(ctx))
  }
  return results
}

const STATUS_ICON: Record<CheckStatus, string> = {
  ok: "✓",
  warn: "△",
  fail: "✗",
  skip: "⊝",
}

const STATUS_COLOR: Record<CheckStatus, string> = {
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  fail: "\x1b[31m",
  skip: "\x1b[90m",
}
const RESET = "\x1b[0m"

function renderHuman(results: CheckResult[], noColor: boolean): string {
  const lines: string[] = ["", "  ax-code release check", ""]
  for (const r of results) {
    const color = noColor ? "" : STATUS_COLOR[r.status]
    const reset = noColor ? "" : RESET
    lines.push(`  ${color}${STATUS_ICON[r.status]}${reset}  ${r.name}: ${r.detail}`)
    if (r.remediation && (r.status === "warn" || r.status === "fail")) {
      lines.push(`     Remediation: ${r.remediation}`)
    }
  }
  const passed = results.filter((r) => r.status === "ok").length
  const warned = results.filter((r) => r.status === "warn").length
  const failed = results.filter((r) => r.status === "fail").length
  const skipped = results.filter((r) => r.status === "skip").length
  lines.push("")
  const summary = [
    `${passed} passed`,
    warned > 0 ? `${warned} warning(s)` : null,
    failed > 0 ? `${failed} failed` : null,
    skipped > 0 ? `${skipped} skipped` : null,
  ]
    .filter(Boolean)
    .join(", ")
  const verdict =
    failed > 0 ? "Not ready to release." : warned > 0 ? "Ready, but review warnings above." : "Ready to release."
  lines.push(`  ${summary}. ${verdict}`)
  lines.push("")
  return lines.join("\n")
}

// ───── yargs command ──────────────────────────────────────────────

export const ReleaseCheckCommand = cmd({
  command: "check",
  describe: "validate release-critical conditions before tagging",
  builder: (y) =>
    y
      // Disable yargs's built-in --version on this subcommand so our
      // --for-version option doesn't print a "reserved word" warning.
      .version(false)
      .option("for-version", {
        type: "string",
        describe: "Override the version being checked (default: packages/ax-code/package.json)",
      })
      .option("with-tests", {
        type: "boolean",
        default: false,
        describe: "Run the deterministic test group (adds 2-5 minutes)",
      })
      .option("fetch", {
        type: "boolean",
        default: false,
        describe: "Run `git fetch origin main` before branch-sync (default: off; purely read-only otherwise)",
      })
      .option("skip", {
        type: "string",
        describe: "Comma-separated check ids to skip (e.g. typecheck,tests)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Emit machine-readable JSON output",
      })
      .option("color", {
        type: "boolean",
        default: true,
        describe: "Use ANSI colors (pass --no-color to disable)",
      }),
  async handler(args) {
    try {
      const repoRoot = await findRepoRoot()
      const version = (args["for-version"] as string | undefined) ?? (await readPackageVersion(repoRoot))
      const skipList = ((args.skip as string | undefined) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const unknownSkips = skipList.filter((id) => !CHECK_IDS.includes(id))
      if (unknownSkips.length > 0) {
        throw new Error(`Unknown --skip id(s): ${unknownSkips.join(", ")}. Known ids: ${CHECK_IDS.join(", ")}`)
      }
      const skip = new Set(skipList)
      const ctx: CheckContext = {
        repoRoot,
        version,
        withTests: args["with-tests"] === true,
        fetch: args.fetch === true,
        skip,
      }
      const results = await runChecks(ctx)
      const failed = results.some((r) => r.status === "fail")

      if (args.json) {
        process.stdout.write(JSON.stringify({ version, results }, null, 2) + "\n")
      } else {
        process.stdout.write(renderHuman(results, args.color === false))
      }
      process.exit(failed ? 1 : 0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`ax-code release check: ${msg}\n`)
      process.exit(2)
    }
  },
})
