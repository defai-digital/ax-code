/**
 * Post-phase verification system
 * Ported from ax-cli's verification module
 *
 * Runs TypeScript type checking and optional linting after phase execution
 */

import { Log } from "../../util/log"

const log = Log.create({ service: "planner.verify" })

export type VerificationStatus = "passed" | "failed" | "skipped" | "timeout"

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
    const proc = Bun.spawn(["npx", "tsc", "--noEmit", "--pretty", "false"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    })

    const timer = setTimeout(() => proc.kill(), timeout)
    const code = await proc.exited
    clearTimeout(timer)

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const output = (stdout + stderr).trim()
    const issues = parseTypeScriptErrors(output)

    const passed = code === 0
    log.info("typecheck", { passed, issues: issues.length, duration: Date.now() - start })

    return {
      name,
      type: "typecheck",
      passed,
      status: passed ? "passed" : "failed",
      issues,
      duration: Date.now() - start,
      output,
    }
  } catch (e) {
    return {
      name,
      type: "typecheck",
      passed: false,
      status: "failed",
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
  const parts = cmd.split(" ")

  try {
    const proc = Bun.spawn(parts, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CI: "true" },
    })

    const timer = setTimeout(() => proc.kill(), timeout)
    const code = await proc.exited
    clearTimeout(timer)

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const passed = code === 0

    return {
      name: cmd,
      type: "custom",
      passed,
      status: passed ? "passed" : "failed",
      issues: [],
      duration: Date.now() - start,
      output: (stdout + stderr).trim(),
    }
  } catch (e) {
    return {
      name: cmd,
      type: "custom",
      passed: false,
      status: "failed",
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
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      severity: match[4] as "error" | "warning",
      code: match[5],
      message: match[6],
    })
  }

  return issues
}
