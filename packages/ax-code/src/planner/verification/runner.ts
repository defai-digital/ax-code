import fs from "fs/promises"
import path from "path"
import { CodeIntelligence } from "../../code-intelligence"
import type { ProjectID } from "../../project/schema"
import type { DebugEngine } from "../../debug-engine"
import { Log } from "../../util/log"

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

// Resolve the typecheck/lint/test commands for a project. Defaults pick up
// `bun run <script>` when package.json defines the matching script;
// `override` lets callers force a specific command (or null to skip).
export async function resolveCommands(cwd: string, override?: CommandOverride): Promise<CommandSet> {
  const pkgPath = path.join(cwd, "package.json")
  let scripts: Record<string, string> = {}
  try {
    const raw = await fs.readFile(pkgPath, "utf8")
    const pkg = JSON.parse(raw)
    scripts = pkg.scripts ?? {}
  } catch {
    scripts = {}
  }

  const typecheck =
    override?.typecheck !== undefined ? override.typecheck : scripts.typecheck ? "bun run typecheck" : null
  const lint = override?.lint !== undefined ? override.lint : scripts.lint ? "bun run lint" : null
  const test = override?.test !== undefined ? override.test : scripts.test ? "bun test" : null

  return { typecheck, lint, test }
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
  const proc = Bun.spawn({
    cmd: ["sh", "-c", cmd],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill("SIGKILL")
  }, timeoutMs)
  try {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    const code = await proc.exited
    return { ok: code === 0 && !timedOut, stdout, stderr, code, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

export async function runCheck(
  label: string,
  cmd: string | null,
  cwd: string,
): Promise<DebugEngine.CheckResult & { skipped: boolean }> {
  if (!cmd) {
    log.info(`${label}: skipped (no command configured)`)
    return { ok: true, errors: [], skipped: true }
  }
  const result = await runCommand(cmd, cwd)
  log.info(`${label}: ${result.ok ? "ok" : "failed"}`, { code: result.code })
  if (result.ok) return { ok: true, errors: [], skipped: false }
  // Surface the first ~20 lines of the error stream. Full output is captured
  // in the log; the returned `errors` array is what callers show to the user.
  const lines = (result.stderr || result.stdout).split("\n").filter(Boolean).slice(0, 20)
  return { ok: false, errors: lines, skipped: false }
}

export async function runTests(
  cmd: string | null,
  cwd: string,
  affectedFiles: string[],
  projectID: ProjectID,
  scope: "worktree" | "none",
): Promise<DebugEngine.TestResult & { skipped: boolean }> {
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
    }
  }
  const lines = (result.stderr || result.stdout).split("\n").filter(Boolean).slice(0, 30)
  return {
    ok: false,
    errors: lines,
    ran: dependents.size || 1,
    failed: 1,
    failures: lines.slice(0, 5),
    selection,
    skipped: false,
  }
}
