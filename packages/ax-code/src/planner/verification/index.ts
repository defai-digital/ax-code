/**
 * Post-phase verification system
 * Ported from ax-cli's verification module
 *
 * Runs TypeScript type checking and optional linting after phase execution
 */

import { Log } from "../../util/log"

const log = Log.create({ service: "planner.verify" })

// "failed" means the verifier ran and reported issues.
// "error" means the verifier itself could not run (missing binary,
// spawn failure, internal crash). Consumers that previously only
// checked `passed === false` still see both as failing, but they can
// now distinguish between "your code has type errors" and "the
// typechecker isn't installed / crashed". See BUG-79.
export type VerificationStatus = "passed" | "failed" | "skipped" | "timeout" | "error"

export interface VerificationIssue {
  file: string
  line?: number
  column?: number
  severity: "error" | "warning"
  message: string
  code?: string
}

export interface VerificationResult {
  name: string
  type: "typecheck" | "lint" | "test" | "custom"
  passed: boolean
  status: VerificationStatus
  issues: VerificationIssue[]
  duration: number
  output?: string
}

export interface PhaseVerification {
  phaseId: string
  passed: boolean
  results: VerificationResult[]
  duration: number
}

/**
 * Run TypeScript type checking
 */
export async function typecheck(cwd: string, timeout = 60_000): Promise<VerificationResult> {
  const start = Date.now()
  const name = "typecheck"

  try {
    const proc = Bun.spawn(["bun", "typecheck"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeout)
    const [code, stdout, stderr] = await Promise.all([
      proc.exited.finally(() => {
        clearTimeout(timer)
      }),
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const output = (stdout + stderr).trim()
    const issues = parseTypeScriptErrors(output)

    const passed = code === 0
    log.info("typecheck", { passed, issues: issues.length, duration: Date.now() - start })

    return {
      name,
      type: "typecheck",
      passed,
      status: timedOut ? "timeout" : passed ? "passed" : "failed",
      issues,
      duration: Date.now() - start,
      output,
    }
  } catch (e) {
    // The outer try catches process-level failures: missing `tsc`
    // binary, spawn EACCES, the output-parsing code throwing on an
    // unexpected format, etc. These are infrastructure problems, not
    // type errors — surface them as `status: "error"` with an empty
    // issues list. The previous catch-all reported them as
    // `status: "failed"` which made the planner believe the user's
    // code had type errors when in fact the typechecker never ran.
    // See BUG-79.
    return {
      name,
      type: "typecheck",
      passed: false,
      status: "error",
      issues: [],
      duration: Date.now() - start,
      output: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Run a custom verification command
 */
export async function custom(cmd: string, cwd: string, timeout = 60_000): Promise<VerificationResult> {
  const start = Date.now()
  const shell = process.platform === "win32" ? ["cmd", "/c", cmd] : ["sh", "-c", cmd]

  try {
    const proc = Bun.spawn(shell, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CI: "true" },
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeout)
    const [code, stdout, stderr] = await Promise.all([
      proc.exited.finally(() => {
        clearTimeout(timer)
      }),
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const passed = code === 0

    return {
      name: cmd,
      type: "custom",
      passed,
      status: timedOut ? "timeout" : passed ? "passed" : "failed",
      issues: [],
      duration: Date.now() - start,
      output: (stdout + stderr).trim(),
    }
  } catch (e) {
    // Same rationale as the typecheck catch above — a spawn failure
    // or parse crash is not the same thing as the command returning
    // a non-zero exit code. See BUG-79.
    return {
      name: cmd,
      type: "custom",
      passed: false,
      status: "error",
      issues: [],
      duration: Date.now() - start,
      output: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Verify a phase by running configured checks
 */
export async function verify(
  phaseId: string,
  cwd: string,
  checks: { typecheck?: boolean; commands?: string[] } = {},
): Promise<PhaseVerification> {
  const start = Date.now()
  const results: VerificationResult[] = []

  if (checks.typecheck !== false) {
    results.push(await typecheck(cwd))
  }

  if (checks.commands) {
    for (const cmd of checks.commands) {
      results.push(await custom(cmd, cwd))
    }
  }

  const passed = results.every((r) => r.passed)

  return {
    phaseId,
    passed,
    results,
    duration: Date.now() - start,
  }
}

function parseTypeScriptErrors(output: string): VerificationIssue[] {
  const issues: VerificationIssue[] = []
  // TypeScript error format: file(line,col): error TSxxxx: message
  const pattern = /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm
  let match

  while ((match = pattern.exec(output)) !== null) {
    issues.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity: match[4] as "error" | "warning",
      code: match[5],
      message: match[6],
    })
  }

  return issues
}
