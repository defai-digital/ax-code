// Runtime-agnostic child-process helpers for scripts, replacing Bun.spawn so
// scripts run under tsx/Node. (ADR-036 P4 — porting scripts off Bun APIs.)
import { spawn as crossSpawn } from "cross-spawn"

export interface CaptureResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Run a command capturing stdout/stderr (stdin ignored). Replaces
 * `Bun.spawn(cmd, { stdout: "pipe" })` + `new Response(proc.stdout).text()`.
 */
export function capture(cmd: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(cmd[0]!, cmd.slice(1), {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()))
    child.once("error", reject)
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/**
 * Fire-and-forget spawn with stdio ignored (e.g. win32 `taskkill`). Never
 * throws — mirrors the try/catch around the old `Bun.spawn` best-effort calls.
 */
export function detached(cmd: string[], opts: { cwd?: string } = {}): void {
  try {
    const child = crossSpawn(cmd[0]!, cmd.slice(1), { cwd: opts.cwd, stdio: "ignore" })
    child.once("error", () => {})
    child.unref()
  } catch {
    // best-effort
  }
}
