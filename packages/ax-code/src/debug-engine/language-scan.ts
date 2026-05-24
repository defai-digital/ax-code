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
import { Instance } from "../project/instance"

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

type LanguageScanTool = "cargo-clippy" | "ruff" | "mypy"
type ParsedLanguageScan = Pick<LanguageScanResult, "findings" | "filesScanned">
type DetectLanguageToolInput = {
  cwd?: string
  args?: string[]
  timeoutMs?: number
}

function languageScanSuccess(
  tool: LanguageScanTool,
  parsed: ParsedLanguageScan,
  startedAt: number,
): LanguageScanResult {
  return {
    findings: parsed.findings,
    tool,
    filesScanned: parsed.filesScanned,
    elapsedMs: performance.now() - startedAt,
  }
}

function languageScanError(
  tool: LanguageScanTool,
  err: unknown,
  startedAt: number,
  missingToolMessage: string,
): LanguageScanResult {
  const errorMsg = err instanceof Error ? err.message : String(err)
  return {
    findings: [],
    tool,
    filesScanned: 0,
    elapsedMs: performance.now() - startedAt,
    error: isMissingToolError(errorMsg) ? missingToolMessage : errorMsg,
  }
}

function isMissingToolError(errorMsg: string): boolean {
  return errorMsg.includes("ENOENT") || errorMsg.includes("not found")
}

// ─── Cargo Clippy Scanner ──────────────────────────────────────────

export type DetectClippyInput = DetectLanguageToolInput

interface ClippyDiagnosticMessage {
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

interface ClippyJsonMessage {
  message?: ClippyDiagnosticMessage
  spans?: ClippyDiagnosticMessage["spans"]
  code?: ClippyDiagnosticMessage["code"]
  level?: string
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
    return languageScanSuccess("cargo-clippy", parseClippyOutput(output), t0)
  } catch (err) {
    return languageScanError("cargo-clippy", err, t0, "cargo not found — install Rust toolchain to enable clippy scanning")
  }
}

export function parseClippyOutput(output: string): ParsedLanguageScan {
  const findings: LanguageFinding[] = []
  const filesScanned = new Set<string>()

  for (const line of output.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as ClippyJsonMessage
      const msg = parsed.message?.spans ? parsed.message : (parsed as unknown as ClippyDiagnosticMessage)
      if (!msg.spans || msg.spans.length === 0) continue

      const primarySpan = msg.spans.find((s) => s.is_primary) ?? msg.spans[0]
      if (!primarySpan) continue

      filesScanned.add(primarySpan.file_name)

      findings.push({
        file: primarySpan.file_name,
        line: primarySpan.line_start,
        endLine: primarySpan.line_end,
        column: primarySpan.column_start,
        endColumn: primarySpan.column_end,
        code: msg.code?.code ?? "clippy",
        message: msg.message,
        severity: mapClippyLevel(msg.level ?? "info"),
        language: "rust",
        tool: "cargo-clippy",
      })
    } catch {
      // Non-JSON lines (cargo progress, etc.) are not findings.
    }
  }

  return { findings, filesScanned: filesScanned.size }
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

export type DetectRuffInput = DetectLanguageToolInput

type RuffDiagnostic = {
  code?: string | null
  message: string
  location: { row: number; column: number }
  end_location?: { row: number; column: number }
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
}

type RuffJsonOutput =
  | RuffDiagnostic[]
  | {
      diagnostics?: RuffDiagnostic[]
    }

function ruffDiagnostics(json: RuffJsonOutput): RuffDiagnostic[] {
  return Array.isArray(json) ? json : (json.diagnostics ?? [])
}

export async function detectRuff(input: DetectRuffInput = {}): Promise<LanguageScanResult> {
  const t0 = performance.now()
  const cwd = input.cwd ?? Instance.worktree ?? process.cwd()
  const args = ["check", "--output-format=json", "--show-fixes", ...(input.args ?? [])]

  try {
    const output = await runCommand("ruff", args, cwd, input.timeoutMs ?? 60_000)
    return languageScanSuccess("ruff", parseRuffOutput(output), t0)
  } catch (err) {
    return languageScanError("ruff", err, t0, "ruff not found — install ruff (pip install ruff) to enable Python scanning")
  }
}

export function parseRuffOutput(output: string): ParsedLanguageScan {
  const json = JSON.parse(output) as RuffJsonOutput
  const findings: LanguageFinding[] = []
  const filesScanned = new Set<string>()

  for (const diag of ruffDiagnostics(json)) {
    const code = diag.code || "ruff"
    const endLocation = diag.end_location ?? diag.location
    filesScanned.add(diag.filename)
    findings.push({
      file: diag.filename,
      line: diag.location.row,
      column: diag.location.column,
      endLine: endLocation.row,
      endColumn: endLocation.column,
      code,
      message: diag.message,
      severity: mapRuffSeverity(code),
      language: "python",
      tool: "ruff",
    })
  }

  return { findings, filesScanned: filesScanned.size }
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

export type DetectMypyInput = DetectLanguageToolInput

interface MypyJsonOutput {
  files: Array<{
    path: string
    messages?: Array<{
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
    return languageScanSuccess("mypy", parseMypyOutput(output), t0)
  } catch (err) {
    return languageScanError("mypy", err, t0, "mypy not found — install mypy (pip install mypy) to enable Python type checking")
  }
}

export function parseMypyOutput(output: string): ParsedLanguageScan {
  const json = JSON.parse(output) as MypyJsonOutput
  const findings: LanguageFinding[] = []
  const filesScanned = new Set<string>()

  for (const file of json.files ?? []) {
    filesScanned.add(file.path)
    for (const msg of file.messages ?? []) {
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

  return { findings, filesScanned: filesScanned.size }
}

// ─── Unified language scan ─────────────────────────────────────────

export type DetectLanguageInput = {
  cwd?: string
  languages?: ("rust" | "python")[]
  timeoutMs?: number
}

export async function detectLanguage(input: DetectLanguageInput = {}): Promise<LanguageScanResult[]> {
  const languages = input.languages ?? ["rust", "python"]
  const results: LanguageScanResult[] = []

  if (languages.includes("rust")) {
    results.push(await detectClippy({ cwd: input.cwd, timeoutMs: input.timeoutMs }))
  }
  if (languages.includes("python")) {
    results.push(await detectRuff({ cwd: input.cwd, timeoutMs: input.timeoutMs }))
    results.push(await detectMypy({ cwd: input.cwd, timeoutMs: input.timeoutMs }))
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
