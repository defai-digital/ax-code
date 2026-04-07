import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import type { ProjectID } from "../project/schema"
import { DebugEngine } from "./index"

// detectHardcodes — DRE-owned AST-lite scan for common anti-patterns
// that belong in configuration instead of code.
//
// ADR-002: this does NOT hook into CodeGraphBuilder. It's a standalone
// text scan run on demand against the files in scope. Phase 2 uses
// line-based regex detection (no tree-sitter dependency); Phase 3+ can
// swap in a real AST walker behind the same API if false positives
// become a problem at scale.
//
// Categories detected:
//   magic_number       — numeric literals other than -1/0/1/2 in
//                        non-test code, not part of an enum or const
//                        declaration
//   inline_url         — http(s):// URLs outside comments
//   inline_path        — absolute filesystem paths (/Users/..., C:\...)
//   inline_secret_shape— high-entropy strings that look like tokens;
//                        matched by shape/length only, no known-key regex

export type DetectHardcodesInput = {
  scope?: "worktree" | "none"
  patterns?: DebugEngine.HardcodeKind[]
  excludeTests?: boolean
  // Glob(s) to include (defaults to TS/JS sources)
  include?: string[]
  // Pre-resolved file list for incremental scanning.
  files?: string[]
  // Hard cap on files inspected; when hit, output is marked truncated.
  maxFiles?: number
  // Cap per file; prevents one huge generated file from dominating the
  // result set.
  maxFindingsPerFile?: number
}

const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"]
const DEFAULT_EXCLUDE_DIRS = ["node_modules", "dist", "build", ".cache", ".git", ".next", "coverage"]
const DEFAULT_MAX_FILES = 500
const DEFAULT_MAX_PER_FILE = 20

// Numbers we consider "obviously fine" and never flag. 0/1/-1/2 cover
// indexing, booleans, comparisons. 100/1000 occasionally make sense
// but we keep them in the flag set and let severity sort them out.
const TRIVIAL_NUMBERS = new Set(["0", "1", "-1", "2"])

// Secret shape: a string of at least 30 chars composed of mixed-case
// letters, digits, and common base64/base64url characters, with high
// Shannon entropy. Raised from 20 to 30 in the precision overhaul —
// 20-char class names like OAuth2AuthorizationCodeGrant triggered
// false positives at the old threshold.
const SECRET_SHAPE_MIN_LEN = 30
const SECRET_ENTROPY_THRESHOLD = 3.5

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / s.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function isTestFile(file: string): boolean {
  return /(^|\/)(test|tests|__tests__|__mocks__|spec)\//.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file)
}

function isExcludedDir(file: string, cwd: string): boolean {
  const rel = path.relative(cwd, file)
  const segments = rel.split(path.sep)
  return segments.some((seg) => DEFAULT_EXCLUDE_DIRS.includes(seg))
}

// Strip single-line comments (both `//` and inline `/* ... */` that
// open and close on the same line). Multi-line block comments are
// tracked by the scanner loop in scanFile — this helper only handles
// what it can see on the line in front of it. See issue #23.
function stripComments(line: string): string {
  // Inline block comments `/* ... */`. Repeat the strip until the
  // pattern is gone: a single line can carry multiple blocks like
  // `const x = 1 /* a */ + /* b */ 2`.
  let out = line
  while (true) {
    const next = out.replace(/\/\*[\s\S]*?\*\//g, "")
    if (next === out) break
    out = next
  }
  // Line comment `// ...` at the end of a line, only if not inside a
  // string literal on the same line (naive quote-balance check).
  const lineIdx = out.indexOf("//")
  if (lineIdx >= 0) {
    const prefix = out.slice(0, lineIdx)
    const dblQuotes = (prefix.match(/"/g) ?? []).length
    const sglQuotes = (prefix.match(/'/g) ?? []).length
    if (dblQuotes % 2 === 0 && sglQuotes % 2 === 0) return prefix
  }
  return out
}

type Detector = (line: string, trimmedLine: string) => Array<{ value: string; column: number }>

// Magic number detector. Skips:
//   - TRIVIAL_NUMBERS
//   - Numbers inside `const`/`enum` declarations (they're already in
//     a named constant, which is the refactor target)
//   - Numbers inside array index brackets `[0]` (matched via context)
//   - Numbers that look like years (1900–2100) — those are almost
//     always fine where they appear (copyright, dates)
const magicNumberDetector: Detector = (original, trimmed) => {
  const line = stripComments(original)
  // Skip top-level SCREAMING_SNAKE_CASE constant declarations — the
  // literal IS already extracted into a named symbol, flagging it
  // would be noise. Accept an optional `export` prefix.
  if (/^\s*(export\s+)?(const|let|var)\s+[A-Z_][A-Z0-9_]*\s*(:[^=]+)?=/.test(trimmed)) return []
  if (/^\s*(export\s+)?(enum|type)\s/.test(trimmed)) return []

  const results: Array<{ value: string; column: number }> = []
  // Match integer and decimal literals not immediately inside a
  // bracketed index expression. The regex captures `column` via match
  // index.
  const re = /(?<![\w.])(-?\d+(?:\.\d+)?)(?!\w)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const value = m[1]
    if (TRIVIAL_NUMBERS.has(value)) continue
    const asNumber = Number(value)
    if (Number.isInteger(asNumber) && asNumber >= 1900 && asNumber <= 2100) continue
    // Context check: is this inside an array index like `arr[3]`?
    const preceding = line.slice(0, m.index)
    if (preceding.endsWith("[") && line[m.index + value.length] === "]") continue
    results.push({ value, column: m.index })
  }
  return results
}

// Heuristic: line is a const/enum assignment. URLs and paths in named
// constants are already extracted — flagging them is noise.
function isConstAssignment(line: string): boolean {
  return /^\s*(export\s+)?(const|let|var)\s+[A-Z_a-z]\w*\s*(:[^=]+)?=/.test(line)
}

const urlDetector: Detector = (original, trimmed) => {
  const line = stripComments(original)
  // Skip URLs assigned to a named constant — the value is already
  // extracted and flagging it adds no signal.
  if (isConstAssignment(trimmed)) return []
  const results: Array<{ value: string; column: number }> = []
  const re = /https?:\/\/[^\s"')<>]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    results.push({ value: m[0], column: m.index })
  }
  return results
}

const pathDetector: Detector = (original, trimmed) => {
  const line = stripComments(original)
  // Skip paths assigned to a named constant — already extracted.
  if (isConstAssignment(trimmed)) return []
  const results: Array<{ value: string; column: number }> = []
  // Unix absolute path in a string literal: "/Users/...", "/home/..."
  const re = /"((?:\/Users\/|\/home\/|\/opt\/|\/var\/|\/etc\/|\/tmp\/|[A-Z]:\\)[^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    results.push({ value: m[1], column: m.index })
  }
  return results
}

// Heuristic: a string that looks like a class/type name rather than a
// secret — PascalCase identifiers, optionally with digits. These show
// up in base64-ish character classes and trigger false positives.
function looksLikeClassName(s: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*([A-Z][a-zA-Z0-9]*){2,}$/.test(s)
}

// Known non-secret patterns: base64-encoded images, CSS data URIs,
// SVG path data, common long identifiers, snake_case/kebab-case names.
function isKnownNonSecret(s: string): boolean {
  if (looksLikeClassName(s)) return true
  // snake_case identifiers (DB column names, error codes, event names)
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(s)) return true
  // kebab-case identifiers (CSS classes, npm package names, import paths)
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(s)) return true
  // Base64-encoded data URI fragments (images, fonts)
  if (/^[A-Za-z0-9+/]+=*$/.test(s) && s.endsWith("=")) return true
  // SVG path data (`M0 0L10 10...`)
  if (/^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/.test(s)) return true
  return false
}

// Require at least 3 distinct character classes for a string to look
// like a secret. Real tokens mix uppercase, lowercase, digits, and
// special chars. Identifiers typically use only 1-2 classes.
function hasCharClassDiversity(s: string): boolean {
  let classes = 0
  if (/[A-Z]/.test(s)) classes++
  if (/[a-z]/.test(s)) classes++
  if (/[0-9]/.test(s)) classes++
  if (/[^A-Za-z0-9]/.test(s)) classes++
  return classes >= 3
}

const secretShapeDetector: Detector = (original) => {
  const line = stripComments(original)
  const results: Array<{ value: string; column: number }> = []
  const re = /"([A-Za-z0-9_\-+/=]{20,})"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const candidate = m[1]
    if (candidate.length < SECRET_SHAPE_MIN_LEN) continue
    // Skip obvious non-secrets: UUIDs with dashes in fixed positions,
    // file hashes (all hex), base64 of a short word.
    if (/^[a-f0-9]+$/i.test(candidate) && candidate.length <= 40) continue // sha1/sha256 hex
    // Skip class names and known non-secret patterns (precision overhaul)
    if (isKnownNonSecret(candidate)) continue
    // Require character class diversity — real secrets mix case + digits
    if (!hasCharClassDiversity(candidate)) continue
    const entropy = shannonEntropy(candidate)
    if (entropy < SECRET_ENTROPY_THRESHOLD) continue
    results.push({ value: candidate, column: m.index })
  }
  return results
}

function severityFor(kind: DebugEngine.HardcodeKind, value: string): DebugEngine.HardcodeFinding["severity"] {
  if (kind === "inline_secret_shape") return "high"
  if (kind === "inline_path") return "medium"
  if (kind === "inline_url") {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value) ? "low" : "medium"
  }
  if (kind === "magic_number") {
    const n = Number(value)
    if (Number.isFinite(n) && Math.abs(n) >= 1000) return "medium"
    return "low"
  }
  return "low"
}

function suggestionFor(kind: DebugEngine.HardcodeKind): string {
  if (kind === "inline_secret_shape") return "Move to environment variable or secret manager"
  if (kind === "inline_url") return "Move to config.ts or .env"
  if (kind === "inline_path") return "Use a path resolver relative to the project root"
  if (kind === "magic_number") return "Extract to a named constant in config.ts"
  return "Review for extraction"
}

async function scanFile(
  file: string,
  enabledKinds: Set<DebugEngine.HardcodeKind>,
  maxPerFile: number,
): Promise<DebugEngine.HardcodeFinding[]> {
  const content = await fs.readFile(file, "utf8").catch(() => "")
  if (!content) return []
  const lines = content.split("\n")
  const findings: DebugEngine.HardcodeFinding[] = []

  // Cross-line block comment state. The old code skipped lines that
  // started with `*` or `/*`, but that missed: (1) the opening line
  // when code precedes `/*`, (2) the closing line when code follows
  // `*/`, and (3) interior lines that don't start with a leading
  // `*`. Each of those carried magic numbers and secret-shaped
  // strings inside JSDoc blocks that the scanner reported as real
  // hardcodes. Track the open/close state here; stripComments still
  // handles the single-line cases on its own. See issue #23.
  let inBlockComment = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue

    // Walk the line accounting for block comment state. Any portion
    // of the line that falls inside a block comment is removed; if
    // the block doesn't close on this line, flip `inBlockComment`
    // and skip the rest.
    let remaining = lines[i]
    // Track the column offset when a leading block comment is stripped
    // so that detector-reported columns map back to the original line.
    let columnOffset = 0
    if (inBlockComment) {
      const closeIdx = remaining.indexOf("*/")
      if (closeIdx === -1) continue // whole line is inside a block
      columnOffset = closeIdx + 2
      remaining = remaining.slice(columnOffset)
      inBlockComment = false
    }
    // From here, search for a block-comment opener that isn't
    // closed on the same line. Anything after the unclosed opener
    // belongs to the block and must be stripped; we also flip the
    // state so subsequent lines know we're still inside.
    const openIdx = remaining.indexOf("/*")
    if (openIdx !== -1) {
      const closeIdx = remaining.indexOf("*/", openIdx + 2)
      if (closeIdx === -1) {
        remaining = remaining.slice(0, openIdx)
        inBlockComment = true
      }
    }
    if (remaining.trim().length === 0) continue

    // Re-derive `trimmed` against the (possibly shortened) remainder
    // so downstream detectors see a consistent view. The single-line
    // `//` handler lives in stripComments and will run per-detector.
    const rawForScan = remaining
    const trimmedForScan = remaining.trim()
    if (trimmedForScan.startsWith("//")) continue

    const applyDetector = (kind: DebugEngine.HardcodeKind, detect: Detector) => {
      if (!enabledKinds.has(kind)) return
      for (const hit of detect(rawForScan, trimmedForScan)) {
        if (findings.length >= maxPerFile) return
        findings.push({
          file,
          line: i + 1,
          column: hit.column + 1 + columnOffset,
          kind,
          value: hit.value.length > 120 ? hit.value.slice(0, 117) + "..." : hit.value,
          suggestion: suggestionFor(kind),
          severity: severityFor(kind, hit.value),
        })
      }
    }

    applyDetector("magic_number", magicNumberDetector)
    applyDetector("inline_url", urlDetector)
    applyDetector("inline_path", pathDetector)
    applyDetector("inline_secret_shape", secretShapeDetector)

    if (findings.length >= maxPerFile) break
  }

  return findings
}

export async function detectHardcodesImpl(
  projectID: ProjectID,
  input: DetectHardcodesInput,
): Promise<DebugEngine.HardcodeReport> {
  const excludeTests = input.excludeTests ?? true
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES
  const maxPerFile = input.maxFindingsPerFile ?? DEFAULT_MAX_PER_FILE
  const patterns = input.patterns ?? ["magic_number", "inline_url", "inline_path", "inline_secret_shape"]
  const enabledKinds = new Set(patterns)
  const include = input.include ?? DEFAULT_INCLUDE
  const heuristics: string[] = [`patterns=${patterns.join(",")}`]
  if (excludeTests) heuristics.push("exclude-tests")

  const cwd = Instance.directory

  let allFiles: string[]
  if (input.files && input.files.length > 0) {
    heuristics.push("incremental")
    allFiles = input.files.filter((f) => {
      if (excludeTests && isTestFile(f)) return false
      if (!Instance.containsPath(f)) return false
      return true
    })
  } else {
    // Enumerate candidate files. Glob.scan uses fast-glob under the hood
    // and respects ignore patterns; we filter out test files and common
    // noise directories explicitly because fast-glob doesn't honor
    // .gitignore by default.
    allFiles = []
    for (const pattern of include) {
      const hits = await Glob.scan(pattern, { cwd, absolute: true, dot: false, symlink: false })
      for (const f of hits) {
        if (isExcludedDir(f, cwd)) continue
        if (excludeTests && isTestFile(f)) continue
        // scope=worktree enforcement: every reported file must live inside
        // the current Instance worktree. Mirrors the CodeIntelligence
        // worktree scope filter behavior.
        if (!Instance.containsPath(f)) continue
        allFiles.push(f)
      }
    }
  }

  // Deduplicate (a file can match multiple include patterns).
  const uniqueFiles = [...new Set(allFiles)]
  heuristics.push(`candidate-files=${uniqueFiles.length}`)

  const filesToScan = uniqueFiles.slice(0, maxFiles)
  const truncated = uniqueFiles.length > maxFiles
  if (truncated) heuristics.push("file-cap-hit")

  // Scan in parallel but with a modest cap so we don't open hundreds of
  // file descriptors on a massive repo.
  const CONCURRENCY = 8
  const findings: DebugEngine.HardcodeFinding[] = []
  for (let i = 0; i < filesToScan.length; i += CONCURRENCY) {
    const batch = filesToScan.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map((f) => scanFile(f, enabledKinds, maxPerFile)))
    for (const r of results) findings.push(...r)
  }

  // Sort: severity desc, then file path, then line — deterministic
  // ordering callers can rely on for UI stability.
  const severityRank: Record<DebugEngine.HardcodeFinding["severity"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  }
  findings.sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity]
    }
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return a.line - b.line
  })

  return {
    findings,
    filesScanned: filesToScan.length,
    truncated,
    explain: DebugEngine.buildExplain("detect-hardcodes", [], heuristics),
  }
}
