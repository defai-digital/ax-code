import fs from "fs/promises"
import { DEFAULT_INCLUDE, DEFAULT_MAX_FILES, DEFAULT_MAX_PER_FILE, isExcludedDir, isTestFile } from "./scanner-utils"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import type { ProjectID } from "../project/schema"
import { DebugEngine } from "./index"
import { nativeReadFilesBatch } from "./native-scan"

// detect-races — AST-lite scanner for common race condition patterns
// in async TypeScript code.
//
// Phase 1 uses regex + structural heuristics against the raw source
// text. This catches the most mechanical patterns (TOCTOU across
// await, non-atomic counters, Promise.all with conflicting mutations)
// without requiring a full AST parser or data-flow analysis.
//
// ADR-002: standalone text scan, no v3 writes.

export type DetectRacesInput = {
  scope?: "worktree" | "none"
  patterns?: DebugEngine.RacePattern[]
  excludeTests?: boolean
  include?: string[]
  // Pre-resolved file list for incremental scanning. When provided,
  // skips glob enumeration and scans only these files.
  files?: string[]
  maxFiles?: number
  maxFindingsPerFile?: number
}

// Suppression comment pattern: // @scan-suppress race_scan
const SUPPRESS_RE = /\/\/\s*@scan-suppress\s+race_scan/

// Detect shared mutable state identifiers: module-level `let`, Map, Set,
// class fields with mutable containers.
const SHARED_STATE_DECL_RE = /^\s*(?:export\s+)?(?:let|var)\s+(\w+)/
const MAP_SET_DECL_RE = /(?:new\s+(?:Map|Set|WeakMap|WeakSet)\s*[<(])|(?:\.(?:set|add)\s*\()/

// Extract identifier names from Map/Set get/set operations
const MAP_GET_RE = /(\w+)\.get\s*\(/g
const MAP_SET_RE = /(\w+)\.set\s*\(/g
const COUNTER_RE = /(\w+)\s*(?:\+\+|--|\+=|\-=)/g

type LineInfo = {
  text: string
  trimmed: string
  num: number
  isAwait: boolean
  isAsync: boolean
  suppressed: boolean
}

function parseLines(content: string): LineInfo[] {
  const rawLines = content.split("\n")
  return rawLines.map((text, i) => ({
    text,
    trimmed: text.trim(),
    num: i + 1,
    isAwait: /\bawait\b/.test(text),
    isAsync: /\basync\b/.test(text),
    // Suppression applies to the comment line itself AND the next
    // non-empty line (the common pattern is a comment on its own line
    // followed by the suppressed code).
    suppressed: SUPPRESS_RE.test(text) || (i > 0 && SUPPRESS_RE.test(rawLines[i - 1])),
  }))
}

// Find function/method boundaries by tracking brace depth. Returns
// ranges [startLine, endLine] for each async function scope.
function findAsyncScopes(lines: LineInfo[]): Array<{ start: number; end: number }> {
  const scopes: Array<{ start: number; end: number }> = []
  let depth = 0
  let scopeStart = -1
  let inAsync = false

  for (const line of lines) {
    if (/\basync\b/.test(line.text) && /(?:function|=>|\()/.test(line.text) && depth === 0) {
      inAsync = true
      scopeStart = line.num
    }

    for (const ch of line.text) {
      if (ch === "{") {
        depth++
      } else if (ch === "}") {
        depth--
        if (depth === 0 && inAsync && scopeStart >= 0) {
          scopes.push({ start: scopeStart, end: line.num })
          inAsync = false
          scopeStart = -1
        }
      }
    }
  }
  return scopes
}

// TOCTOU: read shared state → await → write shared state
function detectToctou(lines: LineInfo[], file: string, max: number): DebugEngine.RaceFinding[] {
  const findings: DebugEngine.RaceFinding[] = []
  const scopes = findAsyncScopes(lines)

  for (const scope of scopes) {
    if (findings.length >= max) break
    const scopeLines = lines.filter((l) => l.num >= scope.start && l.num <= scope.end)

    // Track reads and writes to Map-like state within this scope
    const reads: Array<{ name: string; line: number }> = []
    const awaitLines: number[] = []
    const writes: Array<{ name: string; line: number }> = []

    for (const line of scopeLines) {
      if (line.suppressed) continue
      if (line.isAwait) awaitLines.push(line.num)

      // Map.get / Map.has reads
      if (!line.suppressed) {
        const getMatches = line.text.matchAll(MAP_GET_RE)
        for (const m of getMatches) reads.push({ name: m[1], line: line.num })
        const hasRe = /(\w+)\.has\s*\(/g
        const hasMatches = line.text.matchAll(hasRe)
        for (const m of hasMatches) reads.push({ name: m[1], line: line.num })
      }

      // Map.set / Map.delete writes
      if (!line.suppressed) {
        const setMatches = line.text.matchAll(MAP_SET_RE)
        for (const m of setMatches) writes.push({ name: m[1], line: line.num })
        const deleteRe = /(\w+)\.delete\s*\(/g
        const deleteMatches = line.text.matchAll(deleteRe)
        for (const m of deleteMatches) writes.push({ name: m[1], line: line.num })
      }
    }

    // Check: read → await → write on same identifier
    for (const read of reads) {
      for (const write of writes) {
        if (read.name !== write.name) continue
        if (write.line <= read.line) continue
        const hasAwaitBetween = awaitLines.some((a) => a > read.line && a < write.line)
        if (!hasAwaitBetween) continue
        if (findings.length >= max) break
        findings.push({
          file,
          line: read.line,
          endLine: write.line,
          pattern: "toctou",
          severity: "high",
          description: `TOCTOU: \`${read.name}\` read at line ${read.line}, await at lines [${awaitLines.filter((a) => a > read.line && a < write.line).join(",")}], write at line ${write.line}. Another async task may mutate \`${read.name}\` during the await.`,
          code: lines[read.line - 1]?.trimmed ?? "",
          fix: `Use an atomic operation or add a lock/mutex around the read-await-write sequence on \`${read.name}\`.`,
        })
      }
    }
  }
  return findings
}

// Non-atomic counter: counter++ or counter += N across async boundaries
function detectNonAtomicCounter(lines: LineInfo[], file: string, max: number): DebugEngine.RaceFinding[] {
  const findings: DebugEngine.RaceFinding[] = []
  const scopes = findAsyncScopes(lines)

  for (const scope of scopes) {
    if (findings.length >= max) break
    const scopeLines = lines.filter((l) => l.num >= scope.start && l.num <= scope.end)

    const counters: Array<{ name: string; line: number }> = []
    const awaitLines: number[] = []

    for (const line of scopeLines) {
      if (line.suppressed) continue
      if (line.isAwait) awaitLines.push(line.num)
      const matches = line.text.matchAll(COUNTER_RE)
      for (const m of matches) counters.push({ name: m[1], line: line.num })
    }

    // Check if any counter operation has an await before it (in the
    // same scope) — meaning the counter value may be stale.
    for (const counter of counters) {
      const hasAwaitBefore = awaitLines.some((a) => a < counter.line)
      if (!hasAwaitBefore) continue
      if (findings.length >= max) break
      // Skip counters on local variables declared in the same line
      const declLine = scopeLines.find(
        (l) => l.num <= counter.line && new RegExp(`\\b(?:let|var|const)\\s+${counter.name}\\b`).test(l.text),
      )
      // If declared and first used on the same line, skip
      if (declLine && declLine.num === counter.line) continue
      findings.push({
        file,
        line: counter.line,
        pattern: "non_atomic_counter",
        severity: "medium",
        description: `Non-atomic counter: \`${counter.name}\` is modified at line ${counter.line} after an await point. Concurrent async calls may read a stale value.`,
        code: lines[counter.line - 1]?.trimmed ?? "",
        fix: `Use an atomic counter pattern or serialize access to \`${counter.name}\`.`,
      })
    }
  }
  return findings
}

// Promise.all with conflicting mutations: multiple operations on the
// same identifier inside a single Promise.all/Promise.allSettled call.
function detectConflictingMutations(lines: LineInfo[], file: string, max: number): DebugEngine.RaceFinding[] {
  const findings: DebugEngine.RaceFinding[] = []
  const content = lines.map((l) => l.text).join("\n")

  // Match Promise.all/allSettled blocks. This is a heuristic — we look
  // for the opening `Promise.all([` or `Promise.allSettled([` and scan
  // until the matching `])`.
  const promiseAllRe = /Promise\.(?:all|allSettled)\s*\(\s*\[/g
  let match: RegExpExecArray | null
  while ((match = promiseAllRe.exec(content)) !== null) {
    if (findings.length >= max) break
    const startOffset = match.index
    const startLine = content.slice(0, startOffset).split("\n").length

    // Check if this line is suppressed
    if (lines[startLine - 1]?.suppressed) continue

    // Find the closing `])` — count brackets
    let depth = 1
    let i = match.index + match[0].length
    let inString: string | null = null
    while (i < content.length && depth > 0) {
      const ch = content[i]
      if (inString) {
        if (ch === inString && content[i - 1] !== "\\") inString = null
      } else {
        if (ch === '"' || ch === "'" || ch === "`") inString = ch
        else if (ch === "[") depth++
        else if (ch === "]") depth--
      }
      i++
    }
    const block = content.slice(match.index, i)
    const endLine = content.slice(0, i).split("\n").length

    // Look for repeated identifiers being mutated inside the block
    const mutatedIds = new Map<string, number[]>()
    const mutationRe =
      /(\w+)\s*(?:\.(?:set|delete|push|pop|shift|unshift|splice|write|append)\s*\(|\s*(?:\+\+|--|(?<!=)=(?![=>])))/g
    let mMatch: RegExpExecArray | null
    while ((mMatch = mutationRe.exec(block)) !== null) {
      const name = mMatch[1]
      // Skip common safe names
      if (name === "console" || name === "Math" || name === "JSON") continue
      const lineNum = startLine + block.slice(0, mMatch.index).split("\n").length - 1
      const existing = mutatedIds.get(name) ?? []
      existing.push(lineNum)
      mutatedIds.set(name, existing)
    }

    for (const [name, lineNums] of mutatedIds) {
      if (lineNums.length < 2) continue
      if (findings.length >= max) break
      findings.push({
        file,
        line: lineNums[0],
        endLine: lineNums[lineNums.length - 1],
        pattern: "conflicting_mutation",
        severity: "high",
        description: `Promise.all with conflicting mutations: \`${name}\` is mutated at lines [${lineNums.join(",")}] inside a concurrent block. These operations may interleave.`,
        code: lines[lineNums[0] - 1]?.trimmed ?? "",
        fix: `Serialize mutations to \`${name}\` or use separate state per promise branch.`,
      })
    }
  }
  return findings
}

// Event listener registered after await — the event may fire before
// the listener is attached.
function detectStaleListener(lines: LineInfo[], file: string, max: number): DebugEngine.RaceFinding[] {
  const findings: DebugEngine.RaceFinding[] = []
  const scopes = findAsyncScopes(lines)
  const listenerRe = /(\w+)\.(?:on|addEventListener|once)\s*\(/

  for (const scope of scopes) {
    if (findings.length >= max) break
    const scopeLines = lines.filter((l) => l.num >= scope.start && l.num <= scope.end)
    let lastAwaitLine = -1

    for (const line of scopeLines) {
      if (line.suppressed) continue
      if (line.isAwait) lastAwaitLine = line.num

      const lMatch = listenerRe.exec(line.text)
      if (lMatch && lastAwaitLine > 0 && lastAwaitLine < line.num) {
        if (findings.length >= max) break
        findings.push({
          file,
          line: line.num,
          pattern: "stale_listener",
          severity: "medium",
          description: `Event listener on \`${lMatch[1]}\` registered at line ${line.num} after await at line ${lastAwaitLine}. Events emitted during the await window will be missed.`,
          code: line.trimmed,
          fix: `Register the listener before the await, or verify no events can fire during the await.`,
        })
      }
    }
  }
  return findings
}

async function scanFile(
  file: string,
  enabledPatterns: Set<DebugEngine.RacePattern>,
  maxPerFile: number,
  preread?: string,
): Promise<DebugEngine.RaceFinding[]> {
  const content = preread ?? (await fs.readFile(file, "utf8").catch(() => ""))
  if (!content) return []

  // Quick check: skip files without async code
  if (!/\bawait\b/.test(content) && !/\basync\b/.test(content)) return []

  const lines = parseLines(content)
  const findings: DebugEngine.RaceFinding[] = []

  if (enabledPatterns.has("toctou") && findings.length < maxPerFile) {
    findings.push(...detectToctou(lines, file, maxPerFile - findings.length))
  }
  if (enabledPatterns.has("non_atomic_counter") && findings.length < maxPerFile) {
    findings.push(...detectNonAtomicCounter(lines, file, maxPerFile - findings.length))
  }
  if (enabledPatterns.has("conflicting_mutation") && findings.length < maxPerFile) {
    findings.push(...detectConflictingMutations(lines, file, maxPerFile - findings.length))
  }
  if (enabledPatterns.has("stale_listener") && findings.length < maxPerFile) {
    findings.push(...detectStaleListener(lines, file, maxPerFile - findings.length))
  }

  return findings.slice(0, maxPerFile)
}

export async function detectRacesImpl(projectID: ProjectID, input: DetectRacesInput): Promise<DebugEngine.RaceReport> {
  const excludeTests = input.excludeTests ?? true
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES
  const maxPerFile = input.maxFindingsPerFile ?? DEFAULT_MAX_PER_FILE
  const patterns: DebugEngine.RacePattern[] = input.patterns ?? [
    "toctou",
    "non_atomic_counter",
    "conflicting_mutation",
    "stale_listener",
  ]
  const enabledPatterns = new Set(patterns)
  const include = input.include ?? DEFAULT_INCLUDE
  const heuristics: string[] = [`patterns=${patterns.join(",")}`]
  if (excludeTests) heuristics.push("exclude-tests")

  const cwd = Instance.directory

  // Incremental mode: if `files` is provided, use that list directly
  // instead of glob enumeration. This is the fast path for git-diff-aware
  // scanning.
  let allFiles: string[]
  if (input.files && input.files.length > 0) {
    heuristics.push("incremental")
    allFiles = input.files.filter((f) => {
      if (excludeTests && isTestFile(f)) return false
      if (!Instance.containsPath(f)) return false
      return true
    })
  } else {
    allFiles = []
    for (const pattern of include) {
      const hits = await Glob.scan(pattern, { cwd, absolute: true, dot: false, symlink: false })
      for (const f of hits) {
        if (isExcludedDir(f, cwd)) continue
        if (excludeTests && isTestFile(f)) continue
        if (!Instance.containsPath(f)) continue
        allFiles.push(f)
      }
    }
  }

  const uniqueFiles = [...new Set(allFiles)]
  heuristics.push(`candidate-files=${uniqueFiles.length}`)

  const filesToScan = uniqueFiles.slice(0, maxFiles)
  const truncated = uniqueFiles.length > maxFiles
  if (truncated) heuristics.push("file-cap-hit")

  const preread = nativeReadFilesBatch(filesToScan)
  if (preread) heuristics.push("native-batch-read")

  const CONCURRENCY = 8
  const findings: DebugEngine.RaceFinding[] = []
  if (preread) {
    for (const f of filesToScan) {
      const content = preread.get(f)
      if (!content) continue
      findings.push(...(await scanFile(f, enabledPatterns, maxPerFile, content)))
    }
  } else {
    for (let i = 0; i < filesToScan.length; i += CONCURRENCY) {
      const batch = filesToScan.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map((f) => scanFile(f, enabledPatterns, maxPerFile)))
      for (const r of results) findings.push(...r)
    }
  }

  // Sort: severity desc, then file, then line
  const severityRank: Record<DebugEngine.RaceFinding["severity"], number> = {
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
    explain: DebugEngine.buildExplain("detect-races", [], heuristics),
  }
}
