import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import { DebugEngine } from "./index"
import { nativeDetectSecurity } from "./native-scan"
import {
  collectScannerFileBatch,
  resolveScannerDefaults,
  resolveScannerFile,
  scannerFileBatchHeuristics,
  scannerScopeDisabled,
  scannerUsesIncrementalFiles,
  scanScannerFiles,
  sortScannerFindings,
  type ScannerInputControls,
} from "./scanner-utils"

// detect-security — AST-lite scanner for common security anti-patterns.
//
// Phase 2 uses regex + structural heuristics against raw source text.
// Catches the most mechanical patterns (path traversal, command
// injection, env leak, missing validation) without requiring full
// taint analysis. Full data-flow taint analysis is deferred to Phase 3.
//
// ADR-002: standalone text scan, no v3 writes.

export type DetectSecurityInput = ScannerInputControls & {
  patterns?: DebugEngine.SecurityPattern[]
}

const SUPPRESS_RE = /\/\/\s*@scan-suppress\s+security_scan/

function isTrustedPathTraversalScanTarget(file: string): boolean {
  const normalized = file.split(path.sep).join("/")
  if (normalized.includes("/script/")) return true
  return /(^|\/)drizzle\.config\.[cm]?[jt]s$/.test(normalized)
}

// Detect path traversal: path.join/resolve with user-controlled input
// without a subsequent containment check (Filesystem.contains or similar).
function detectPathTraversal(lines: string[], file: string, max: number): DebugEngine.SecurityFinding[] {
  const findings: DebugEngine.SecurityFinding[] = []
  if (isTrustedPathTraversalScanTarget(file)) return findings

  // Match path.join or path.resolve with a variable (not a string literal)
  const pathJoinRe = /path\.(?:join|resolve)\s*\((.+)/
  // Containment checks we look for nearby
  const containmentRe = /(?:contains|containsPath|isSubpath|startsWith|Filesystem\.contains|within|inside)\s*\(/

  for (let i = 0; i < lines.length; i++) {
    if (findings.length >= max) break
    if (SUPPRESS_RE.test(lines[i])) continue
    if (i > 0 && SUPPRESS_RE.test(lines[i - 1])) continue

    const match = pathJoinRe.exec(lines[i])
    if (!match) continue

    // Look for a containment check within +-5 lines
    const nearby = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 6)).join("\n")
    if (containmentRe.test(nearby)) continue

    // Skip if all arguments are string literals (no user input)
    let argsStr = lines[i].slice(lines[i].indexOf("path."))
    if (!argsStr.includes(")")) {
      let j = i + 1
      while (j < lines.length && j < i + 20 && !argsStr.includes(")")) {
        argsStr += " " + lines[j]
        j++
      }
    }
    const allLiterals = /path\.(?:join|resolve)\s*\(\s*(?:["'`][^"'`]*["'`]\s*,?\s*)*\)/.test(argsStr)
    if (allLiterals) continue

    findings.push({
      file,
      line: i + 1,
      pattern: "path_traversal",
      severity: "high",
      description: `path.join/resolve with variable input at line ${i + 1} without containment check. May allow path traversal to access files outside the intended directory.`,
      userControlled: true,
    })
  }
  return findings
}

// Detect command injection: spawn/exec with string concatenation or
// template literals containing variables.
function detectCommandInjection(lines: string[], file: string, max: number): DebugEngine.SecurityFinding[] {
  const findings: DebugEngine.SecurityFinding[] = []
  // Template literal or string concatenation in exec/spawn/execSync
  const execRe = /(?:exec|execSync|execFile|execFileSync)\s*\(\s*(?:`[^`]*\$\{|[^,)]+\+)/
  // spawn with non-literal command
  const spawnConcatRe = /(?:spawn|spawnSync)\s*\(\s*(?:`[^`]*\$\{|[^,)]+\+)/

  for (let i = 0; i < lines.length; i++) {
    if (findings.length >= max) break
    if (SUPPRESS_RE.test(lines[i])) continue
    if (i > 0 && SUPPRESS_RE.test(lines[i - 1])) continue

    const isExec = execRe.test(lines[i])
    const isSpawn = spawnConcatRe.test(lines[i])

    if (!isExec && !isSpawn) continue

    findings.push({
      file,
      line: i + 1,
      pattern: "command_injection",
      severity: "high",
      description: `${isExec ? "exec" : "spawn"} with string interpolation/concatenation at line ${i + 1}. Variable input may allow command injection.`,
      userControlled: true,
    })
  }
  return findings
}

// Detect env leak: forwarding process.env to child processes without
// sanitization (Env.sanitize or explicit allowlist).
function detectEnvLeak(lines: string[], file: string, max: number): DebugEngine.SecurityFinding[] {
  const findings: DebugEngine.SecurityFinding[] = []
  // Spreading process.env into a child process env config
  const envSpreadRe = /env\s*:\s*\{?\s*\.\.\.process\.env/
  // Safe patterns: Env.sanitize, explicit allowlist
  const sanitizeRe = /(?:Env\.sanitize|sanitize(?:Env|Environment)|filterEnv)/

  for (let i = 0; i < lines.length; i++) {
    if (findings.length >= max) break
    if (SUPPRESS_RE.test(lines[i])) continue
    if (i > 0 && SUPPRESS_RE.test(lines[i - 1])) continue

    if (!envSpreadRe.test(lines[i])) continue

    // Check if there's a sanitization call nearby (within +-3 lines)
    const nearby = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join("\n")
    if (sanitizeRe.test(nearby)) continue

    findings.push({
      file,
      line: i + 1,
      pattern: "env_leak",
      severity: "medium",
      description: `process.env spread to child process at line ${i + 1} without sanitization. Secrets (API keys, tokens) may leak to subprocesses.`,
      userControlled: false,
    })
  }
  return findings
}

// Detect missing schema validation on HTTP route handlers.
// Looks for Hono-style route definitions without validator() middleware.
function detectMissingValidation(lines: string[], file: string, max: number): DebugEngine.SecurityFinding[] {
  const findings: DebugEngine.SecurityFinding[] = []
  // Hono route pattern: app.post/put/patch/delete (mutation routes)
  const routeRe = /\.\s*(?:post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/
  // Validator middleware
  const validatorRe = /validator\s*\(/

  for (let i = 0; i < lines.length; i++) {
    if (findings.length >= max) break
    if (SUPPRESS_RE.test(lines[i])) continue
    if (i > 0 && SUPPRESS_RE.test(lines[i - 1])) continue

    const match = routeRe.exec(lines[i])
    if (!match) continue

    // Check if validator is in the same route definition (same line
    // or next few lines before the handler function)
    const nearby = lines.slice(i, Math.min(lines.length, i + 5)).join("\n")
    if (validatorRe.test(nearby)) continue

    findings.push({
      file,
      line: i + 1,
      pattern: "missing_validation",
      severity: "medium",
      description: `Mutation route "${match[1]}" at line ${i + 1} without schema validation middleware. Unvalidated input may cause unexpected behavior.`,
      userControlled: true,
    })
  }
  return findings
}

// Detect SSRF: fetch/axios with a variable URL without prior IP/URL
// validation (assertPublicUrl, isPublic, etc.)
function detectSsrf(lines: string[], file: string, max: number): DebugEngine.SecurityFinding[] {
  const findings: DebugEngine.SecurityFinding[] = []
  // fetch or axios with a variable (not a string literal)
  const fetchRe = /(?:fetch|axios\.(?:get|post|put|delete|patch|request))\s*\(\s*(\w+)/
  // URL validation patterns
  const ssrfGuardRe = /(?:assertPublicUrl|isPublic|validateUrl|Ssrf\.|allowedHosts|urlAllowlist)/

  for (let i = 0; i < lines.length; i++) {
    if (findings.length >= max) break
    if (SUPPRESS_RE.test(lines[i])) continue
    if (i > 0 && SUPPRESS_RE.test(lines[i - 1])) continue

    const match = fetchRe.exec(lines[i])
    if (!match) continue

    // Skip if the argument is a string literal
    const arg = match[1]
    if (/^["'`]/.test(arg)) continue

    // Check for URL validation within +-10 lines
    const nearby = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 3)).join("\n")
    if (ssrfGuardRe.test(nearby)) continue

    findings.push({
      file,
      line: i + 1,
      pattern: "ssrf",
      severity: "high",
      description: `fetch/request with variable URL \`${arg}\` at line ${i + 1} without URL validation. May allow SSRF to internal services.`,
      userControlled: true,
    })
  }
  return findings
}

async function scanFile(
  file: string,
  enabledPatterns: Set<DebugEngine.SecurityPattern>,
  maxPerFile: number,
  preread?: string,
): Promise<DebugEngine.SecurityFinding[]> {
  const content = preread ?? (await fs.readFile(file, "utf8").catch(() => ""))
  if (!content) return []

  const lines = content.split("\n")
  const findings: DebugEngine.SecurityFinding[] = []

  if (enabledPatterns.has("path_traversal") && findings.length < maxPerFile) {
    findings.push(...detectPathTraversal(lines, file, maxPerFile - findings.length))
  }
  if (enabledPatterns.has("command_injection") && findings.length < maxPerFile) {
    findings.push(...detectCommandInjection(lines, file, maxPerFile - findings.length))
  }
  if (enabledPatterns.has("env_leak") && findings.length < maxPerFile) {
    findings.push(...detectEnvLeak(lines, file, maxPerFile - findings.length))
  }
  if (enabledPatterns.has("missing_validation") && findings.length < maxPerFile) {
    findings.push(...detectMissingValidation(lines, file, maxPerFile - findings.length))
  }
  if (enabledPatterns.has("ssrf") && findings.length < maxPerFile) {
    findings.push(...detectSsrf(lines, file, maxPerFile - findings.length))
  }

  return findings.slice(0, maxPerFile)
}

export async function detectSecurityImpl(input: DetectSecurityInput): Promise<DebugEngine.SecurityReport> {
  if (scannerScopeDisabled(input)) {
    return {
      findings: [],
      filesScanned: 0,
      truncated: false,
      explain: DebugEngine.buildExplain("detect-security", [], ["scope=none"]),
    }
  }

  const { excludeTests, maxFiles, maxPerFile, include } = resolveScannerDefaults(input)
  const patterns: DebugEngine.SecurityPattern[] = input.patterns ?? [
    "path_traversal",
    "command_injection",
    "env_leak",
    "missing_validation",
    "ssrf",
  ]
  const enabledPatterns = new Set(patterns)
  const cwd = Instance.directory

  // Native fast-path: run entire detection in Rust (walk + read + regex in parallel)
  if (!scannerUsesIncrementalFiles(input)) {
    const native = nativeDetectSecurity({ cwd, include, patterns, maxFiles, maxPerFile, excludeTests })
    if (native) {
      return {
        findings: native.findings.map((f) => ({
          file: resolveScannerFile(f.file, cwd),
          line: f.line,
          pattern: f.pattern as DebugEngine.SecurityPattern,
          severity: f.severity as DebugEngine.SecurityFinding["severity"],
          description: f.description,
          userControlled: f.userControlled,
        })),
        filesScanned: native.filesScanned,
        truncated: native.truncated,
        explain: DebugEngine.buildExplain("detect-security", [], native.heuristics),
      }
    }
  }

  // JS fallback
  const heuristics: string[] = [`patterns=${patterns.join(",")}`]
  if (excludeTests) heuristics.push("exclude-tests")

  const fileBatch = await collectScannerFileBatch(input, { cwd, include, excludeTests, maxFiles })
  heuristics.push(...scannerFileBatchHeuristics(fileBatch))

  const { findings, usedNativeBatchRead } = await scanScannerFiles(fileBatch.files, (file, content) =>
    scanFile(file, enabledPatterns, maxPerFile, content),
  )
  if (usedNativeBatchRead) heuristics.push("native-batch-read")

  sortScannerFindings(findings)

  return {
    findings,
    filesScanned: fileBatch.files.length,
    truncated: fileBatch.truncated,
    explain: DebugEngine.buildExplain("detect-security", [], heuristics),
  }
}
