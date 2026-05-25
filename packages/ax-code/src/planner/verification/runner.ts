import fs from "fs/promises"
import path from "path"
import { CodeIntelligence } from "../../code-intelligence"
import type { ProjectID } from "../../project/schema"
import type { DebugEngine } from "../../debug-engine"
import { Log } from "../../util/log"
import { Env } from "../../util/env"
import { decodePackageJsonObject, packageJsonStringMap, parsePackageJsonObject } from "../../util/package-json"
import { Process } from "../../util/process"

// Phase 2 P2.1: extracted from src/debug-engine/apply-safe-refactor.ts so
// review/debug/qa workflows (not just refactor_apply) can run typecheck /
// lint / test as a reusable verification step.
//
// The legacy CheckResult / TestResult shapes from DebugEngine are preserved
// here because refactor_apply still consumes them. A future slice can adapt
// callers to consume VerificationEnvelope directly via the builder, at
// which point this runner can shed the legacy shape.

const log = Log.create({ service: "planner.verification.runner" })

export type CommandOverride = {
  typecheck?: string | null
  lint?: string | null
  test?: string | null
}

export type CommandSet = {
  typecheck: string | null
  lint: string | null
  test: string | null
}

export type TimedCheckResult = DebugEngine.CheckResult & {
  skipped: boolean
  timedOut?: boolean
  exitCode?: number
}

export type TimedTestResult = DebugEngine.TestResult & {
  skipped: boolean
  timedOut?: boolean
  exitCode?: number
}

async function fileExists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

async function findCargoRoot(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd)
  while (true) {
    if (await fileExists(path.join(dir, "Cargo.toml"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

async function cargoCommands(cwd: string): Promise<CommandSet | null> {
  const cargoRoot = await findCargoRoot(cwd)
  if (!cargoRoot) return null
  return {
    typecheck: "cargo check",
    lint: "cargo clippy --all-targets --all-features -- -D warnings",
    test: "cargo test",
  }
}

export function decodePackageScripts(value: unknown): Record<string, string> {
  return packageJsonStringMap(decodePackageJsonObject(value).scripts)
}

export function parsePackageScripts(raw: string): Record<string, string> {
  return decodePackageScripts(parsePackageJsonObject(raw))
}

// Resolve the typecheck/lint/test commands for a project. Defaults pick up
// `bun run <script>` when package.json defines the matching script, then fall
// back to Cargo checks when the directory belongs to a Rust workspace;
// `override` lets callers force a specific command (or null to skip).
export async function resolveCommands(cwd: string, override?: CommandOverride): Promise<CommandSet> {
  const pkgPath = path.join(cwd, "package.json")
  let scripts: Record<string, string> = {}
  try {
    const raw = await fs.readFile(pkgPath, "utf8")
    scripts = parsePackageScripts(raw)
  } catch {
    scripts = {}
  }

  const typecheck =
    override?.typecheck !== undefined ? override.typecheck : scripts.typecheck ? "bun run typecheck" : null
  const lint = override?.lint !== undefined ? override.lint : scripts.lint ? "bun run lint" : null
  const test = override?.test !== undefined ? override.test : scripts.test ? "bun test" : null

  const cargo = await cargoCommands(cwd)
  return {
    typecheck: typecheck ?? (override?.typecheck === undefined ? (cargo?.typecheck ?? null) : null),
    lint: lint ?? (override?.lint === undefined ? (cargo?.lint ?? null) : null),
    test: test ?? (override?.test === undefined ? (cargo?.test ?? null) : null),
  }
}

// Hard cap on subprocess runtime. Typecheck/lint/test commands can hang
// (misconfigured tsc, infinite-loop test); without a timeout the caller
// blocks forever while the child holds its PID and pipe fds. 5 minutes is
// conservative enough for large test suites but still bounded.
export const RUN_COMMAND_TIMEOUT_MS = 5 * 60 * 1000

export async function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs: number = RUN_COMMAND_TIMEOUT_MS,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number; timedOut: boolean }> {
  const { code, stdout, stderr } = await Process.run(["sh", "-c", cmd], {
    cwd,
    env: Env.sanitize(),
    timeout: timeoutMs,
    nothrow: true,
  })
  const stdoutText = stdout.toString()
  const stderrText = stderr.toString()

  if (code === 124) {
    return {
      ok: false,
      stdout: "",
      stderr: `command timed out after ${timeoutMs}ms`,
      code,
      timedOut: true,
    }
  }

  return {
    ok: code === 0,
    stdout: stdoutText,
    stderr: stderrText,
    code,
    timedOut: false,
  }
}

export async function runCheck(label: string, cmd: string | null, cwd: string): Promise<TimedCheckResult> {
  if (!cmd) {
    log.info(`${label}: skipped (no command configured)`)
    return { ok: true, errors: [], skipped: true }
  }
  const result = await runCommand(cmd, cwd)
  log.info(`${label}: ${result.ok ? "ok" : "failed"}`, { code: result.code })
  if (result.ok) return { ok: true, errors: [], skipped: false, timedOut: false, exitCode: result.code }
  // Surface the first ~20 lines of the error stream. Full output is captured
  // in the log; the returned `errors` array is what callers show to the user.
  const lines = (result.stderr || result.stdout).split("\n").filter(Boolean).slice(0, 20)
  if (result.timedOut) lines.unshift(`${label} command timed out after ${RUN_COMMAND_TIMEOUT_MS}ms`)
  return { ok: false, errors: lines, skipped: false, timedOut: result.timedOut, exitCode: result.code }
}

export async function runTests(
  cmd: string | null,
  cwd: string,
  affectedFiles: string[],
  projectID: ProjectID,
  scope: "worktree" | "none",
): Promise<TimedTestResult> {
  if (!cmd) return { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped", skipped: true }

  let selection: DebugEngine.TestResult["selection"] = "full-fallback"
  const dependents = new Set<string>()
  for (const file of affectedFiles) {
    const deps = CodeIntelligence.findDependents(projectID, file, { scope })
    for (const d of deps) dependents.add(d)
  }
  if (dependents.size > 0) selection = "targeted"

  // We don't try to rewrite the test command with a selector — each test
  // runner has its own filter flag syntax, and guessing wrong produces
  // false greens. If the command itself supports a `--` escape or similar,
  // the caller configures it via the `test` override. Otherwise we run the
  // full suite and record the selection we *would* have used for audit.
  const result = await runCommand(cmd, cwd)
  if (result.ok) {
    return {
      ok: true,
      errors: [],
      ran: dependents.size || 1,
      failed: 0,
      failures: [],
      selection,
      skipped: false,
      timedOut: false,
      exitCode: result.code,
    }
  }
  const lines = (result.stderr || result.stdout).split("\n").filter(Boolean).slice(0, 30)
  if (result.timedOut) lines.unshift(`test command timed out after ${RUN_COMMAND_TIMEOUT_MS}ms`)
  return {
    ok: false,
    errors: lines,
    ran: dependents.size || 1,
    failed: 1,
    failures: lines.slice(0, 5),
    selection,
    skipped: false,
    timedOut: result.timedOut,
    exitCode: result.code,
  }
}
