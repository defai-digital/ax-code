/**
 * Language-native scanner plugins for the Debug Engine.
 *
 * These scanners run language-specific tooling (cargo clippy, ruff, mypy)
 * and parse their JSON output into structured findings compatible with
 * the Debug Engine's register_finding schema.
 *
 * Unlike the JS/TS-oriented scanners (detect-security, detect-races, etc.),
 * these produce findings from the language's own compiler/linter, so the
 * signal-to-noise ratio is much higher.
 *
 * ADR-002: standalone text scan, no v3 writes.
 */

import { spawn } from "child_process"
import path from "path"
import { Log } from "../util/log"
import type { ProjectID } from "../project/schema"
import { Instance } from "../project/instance"

const log = Log.create({ service: "debug-engine.language-scan" })

// ─── Shared types ──────────────────────────────────────────────────

export interface LanguageFinding {
  file: string
  line: number
  column?: number
  endLine?: number
  endColumn?: number
  code: string
  message: string
  severity: "high" | "medium" | "low" | "info"
  language: "rust" | "python"
  tool: string
}

export interface LanguageScanResult {
  findings: LanguageFinding[]
  tool: string
  toolVersion?: string
  filesScanned: number
  elapsedMs: number
  error?: string
}

// ─── Cargo Clippy Scanner ──────────────────────────────────────────

export type DetectClippyInput = {
  cwd?: string
  projectID?: ProjectID
  args?: string[]
  timeoutMs?: number
}

interface ClippyJsonMessage {
  message: string
  code?: {
    code: string
    explanation?: string
  }
  level: string
  spans: Array<{
    file_name: string
    line_start: number
    line_end: number
    column_start: number
    column_end: number
    is_primary: boolean
    text: Array<{ text: string }>
  }>
}

export async function detectClippy(input: DetectClippyInput = {}): Promise<LanguageScanResult> {
  const t0 = performance.now()
  const cwd = input.cwd ?? Instance.worktree ?? process.cwd()
  const args = [
    "clippy",
    "--all-targets",
    "--all-features",
    "--message-format=json",
    "--",
    "-D",
    "warnings",
    ...(input.args ?? []),
  ]

  try {
    const output = await runCommand("cargo", args, cwd, input.timeoutMs ?? 120_000)
    const findings: LanguageFinding[] = []
    const filesScanned = new Set<string>()

    // Parse JSON lines from cargo output
    for (const line of output.split("\n")) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line) as ClippyJsonMessage
        if (!msg.spans || msg.spans.length === 0) continue

        const primarySpan = msg.spans.find((s) => s.is_primary) ?? msg.spans[0]
        if (!primarySpan) continue

        filesScanned.add(primarySpan.file_name)

        // Map clippy levels to our severity scale
        const severity = mapClippyLevel(msg.level)

        findings.push({
          file: primarySpan.file_name,
          line: primarySpan.line_start,
          endLine: primarySpan.line_end,
          column: primarySpan.column_start,
          endColumn: primarySpan.column_end,
          code: msg.code?.code ?? "clippy",
          message: msg.message,
          severity,
          language: "rust",
          tool: "cargo-clippy",
        })
      } catch {
        // Non-JSON lines (cargo progress, etc.) — skip
      }
    }

    return {
      findings,
      tool: "cargo-clippy",
      filesScanned: filesScanned.size,
      elapsedMs: performance.now() - t0,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    // Check if cargo is not installed
    if (errorMsg.includes("ENOENT") || errorMsg.includes("not found")) {
      return {
        findings: [],
        tool: "cargo-clippy",
        filesScanned: 0,
        elapsedMs: performance.now() - t0,
        error: "cargo not found — install Rust toolchain to enable clippy scanning",
      }
    }
    return {
      findings: [],
      tool: "cargo-clippy",
      filesScanned: 0,
      elapsedMs: performance.now() - t0,
      error: errorMsg,
    }
  }
}

export function mapClippyLevel(level: string): LanguageFinding["severity"] {
  switch (level.toLowerCase()) {
    case "error":
      return "high"
    case "warning":
      return "medium"
    case "help":
      return "low"
    case "note":
      return "info"
    default:
      return "info"
  }
}

// ─── Ruff Scanner ──────────────────────────────────────────────────

export type DetectRuffInput = {
  cwd?: string
  projectID?: ProjectID
  args?: string[]
  timeoutMs?: number
}

interface RuffJsonOutput {
  diagnostics: Array<{
    code: string
    message: string
    location: { row: number; column: number }
    end_location: { row: number; column: number }
    filename: string
    fix?: {
      applicability: string
      message: string
      edits: Array<{
        content: string
        location: { row: number; column: number }
        end_location: { row: number; column: number }
      }>
    }
  }>
}

export async function detectRuff(input: DetectRuffInput = {}): Promise<LanguageScanResult> {
  const t0 = performance.now()
  const cwd = input.cwd ?? Instance.worktree ?? process.cwd()
  const args = ["check", "--output-format=json", "--show-fixes", ...(input.args ?? [])]

  try {
    const output = await runCommand("ruff", args, cwd, input.timeoutMs ?? 60_000)
    const json = JSON.parse(output) as RuffJsonOutput
    const findings: LanguageFinding[] = []
    const filesScanned = new Set<string>()

    for (const diag of json.diagnostics ?? []) {
      filesScanned.add(diag.filename)

      // Map ruff codes to severity
      const severity = mapRuffSeverity(diag.code)

      findings.push({
        file: diag.filename,
        line: diag.location.row,
        column: diag.location.column,
        endLine: diag.end_location.row,
        endColumn: diag.end_location.column,
        code: diag.code,
        message: diag.message,
        severity,
        language: "python",
        tool: "ruff",
      })
    }

    return {
      findings,
      tool: "ruff",
      filesScanned: filesScanned.size,
      elapsedMs: performance.now() - t0,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    if (errorMsg.includes("ENOENT") || errorMsg.includes("not found")) {
      return {
        findings: [],
        tool: "ruff",
        filesScanned: 0,
        elapsedMs: performance.now() - t0,
        error: "ruff not found — install ruff (pip install ruff) to enable Python scanning",
      }
    }
    return {
      findings: [],
      tool: "ruff",
      filesScanned: 0,
      elapsedMs: performance.now() - t0,
      error: errorMsg,
    }
  }
}

export function mapRuffSeverity(code: string): LanguageFinding["severity"] {
  // F-series (pyflakes) and E/W-series (pycodestyle) are typically errors/warnings
  if (code.startsWith("E") || code.startsWith("F")) return "medium"
  if (code.startsWith("W")) return "low"
  // I (isort), UP (pyupgrade), B (bugbear) are suggestions
  if (code.startsWith("I") || code.startsWith("UP") || code.startsWith("B")) return "low"
  // PLC, PLR, PLW (pylint)
  if (code.startsWith("PLC") || code.startsWith("PLR")) return "low"
  if (code.startsWith("PLW")) return "medium"
  return "info"
}

// ─── Mypy Scanner ──────────────────────────────────────────────────

export type DetectMypyInput = {
  cwd?: string
  projectID?: ProjectID
  args?: string[]
  timeoutMs?: number
}

interface MypyJsonOutput {
  files: Array<{
    path: string
    messages: Array<{
      severity: string
      message: string
      line?: number
      column?: number
      end_line?: number
      end_column?: number
    }>
  }>
}

export async function detectMypy(input: DetectMypyInput = {}): Promise<LanguageScanResult> {
  const t0 = performance.now()
  const cwd = input.cwd ?? Instance.worktree ?? process.cwd()
  const args = ["--json-output", ...(input.args ?? [])]

  try {
    const output = await runCommand("mypy", args, cwd, input.timeoutMs ?? 120_000)
    const json = JSON.parse(output) as MypyJsonOutput
    const findings: LanguageFinding[] = []
    const filesScanned = new Set<string>()

    for (const file of json.files ?? []) {
      filesScanned.add(file.path)
      for (const msg of file.messages) {
        findings.push({
          file: file.path,
          line: msg.line ?? 1,
          column: msg.column,
          endLine: msg.end_line,
          endColumn: msg.end_column,
          code: "mypy",
          message: msg.message,
          severity: msg.severity === "error" ? "high" : msg.severity === "warning" ? "medium" : "low",
          language: "python",
          tool: "mypy",
        })
      }
    }

    return {
      findings,
      tool: "mypy",
      filesScanned: filesScanned.size,
      elapsedMs: performance.now() - t0,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    if (errorMsg.includes("ENOENT") || errorMsg.includes("not found")) {
      return {
        findings: [],
        tool: "mypy",
        filesScanned: 0,
        elapsedMs: performance.now() - t0,
        error: "mypy not found — install mypy (pip install mypy) to enable Python type checking",
      }
    }
    return {
      findings: [],
      tool: "mypy",
      filesScanned: 0,
      elapsedMs: performance.now() - t0,
      error: errorMsg,
    }
  }
}

// ─── Unified language scan ─────────────────────────────────────────

export type DetectLanguageInput = {
  cwd?: string
  projectID?: ProjectID
  languages?: ("rust" | "python")[]
  timeoutMs?: number
}

export async function detectLanguage(input: DetectLanguageInput = {}): Promise<LanguageScanResult[]> {
  const languages = input.languages ?? ["rust", "python"]
  const results: LanguageScanResult[] = []

  if (languages.includes("rust")) {
    results.push(await detectClippy({ cwd: input.cwd, projectID: input.projectID, timeoutMs: input.timeoutMs }))
  }
  if (languages.includes("python")) {
    results.push(await detectRuff({ cwd: input.cwd, projectID: input.projectID, timeoutMs: input.timeoutMs }))
    results.push(await detectMypy({ cwd: input.cwd, projectID: input.projectID, timeoutMs: input.timeoutMs }))
  }

  return results
}

// ─── Helper: run command with timeout ──────────────────────────────

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on("data", (d) => (stdout += d.toString()))
    proc.stderr.on("data", (d) => (stderr += d.toString()))

    proc.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut) return
      // clippy/ruff/mypy may exit non-zero with findings — that's OK
      // Only reject on ENOENT or other spawn errors
      if (code === null) {
        reject(new Error(`${cmd} was killed`))
      } else {
        // Return stdout even if non-zero — the JSON output is what matters
        resolve(stdout || stderr)
      }
    })

    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}
