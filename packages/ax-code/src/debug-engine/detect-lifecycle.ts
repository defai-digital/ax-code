import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import type { ProjectID } from "../project/schema"
import { DebugEngine } from "./index"
import { nativeReadFilesBatch, nativeDetectLifecycle } from "./native-scan"
import { DEFAULT_INCLUDE, DEFAULT_MAX_FILES, DEFAULT_MAX_PER_FILE, isExcludedDir, isTestFile } from "./scanner-utils"

// detect-lifecycle — AST-lite scanner for resource lifecycle issues:
// resources that are created but never cleaned up within the same
// function scope.
//
// Phase 1 uses regex-based heuristics against raw source text. It
// tracks resource creation sites and looks for matching cleanup calls
// within the same function body. Cross-function analysis (e.g.,
// constructor create → dispose cleanup) is deferred to Phase 2.
//
// ADR-002: standalone text scan, no v3 writes.

export type DetectLifecycleInput = {
  scope?: "worktree" | "none"
  resourceTypes?: DebugEngine.LifecycleResourceType[]
  excludeTests?: boolean
  include?: string[]
  // Pre-resolved file list for incremental scanning.
  files?: string[]
  maxFiles?: number
  maxFindingsPerFile?: number
}

// Suppression comment pattern
const SUPPRESS_RE = /\/\/\s*@scan-suppress\s+lifecycle_scan/

// Resource patterns: { create regex, cleanup regex, resource type, description }
type ResourceRule = {
  type: DebugEngine.LifecycleResourceType
  createRe: RegExp
  cleanupPatterns: RegExp[]
  description: string
  severity: DebugEngine.LifecycleFinding["severity"]
}

const RESOURCE_RULES: ResourceRule[] = [
  {
    type: "event_listener",
    createRe: /(\w+)\.(?:on|addEventListener)\s*\(\s*["'`](\w+)["'`]/g,
    cleanupPatterns: [/\.(?:off|removeEventListener|removeListener|removeAllListeners)\s*\(/],
    description: "Event listener registered without corresponding removal",
    severity: "medium",
  },
  {
    type: "timer",
    createRe: /(?:setInterval|setTimeout)\s*\(/g,
    cleanupPatterns: [/clearInterval\s*\(/, /clearTimeout\s*\(/],
    description: "setInterval/setTimeout without corresponding clear — timer will run indefinitely",
    severity: "high",
  },
  {
    type: "subscription",
    createRe: /(?:Bus\.subscribe|\.subscribe(?:All)?)\s*\(/g,
    cleanupPatterns: [/unsub\s*\(|unsubscribe\s*\(/],
    description: "Subscription created without unsubscribe — may cause memory leaks",
    severity: "medium",
  },
  {
    type: "abort_controller",
    createRe: /new\s+AbortController\s*\(/g,
    cleanupPatterns: [/\.abort\s*\(/, /\.signal/],
    description: "AbortController created but never aborted or signal never passed to dependent operation",
    severity: "medium",
  },
  {
    type: "child_process",
    createRe: /(?:spawn|Bun\.spawn|exec|execFile|fork)\s*\(/g,
    cleanupPatterns: [/\.kill\s*\(/, /\.on\s*\(\s*["'`](?:exit|close)["'`]/],
    description: "Child process spawned without kill or exit handler — may become orphaned",
    severity: "high",
  },
]

// Track Map growth without bounds
const MAP_GROWTH_SET_RE = /(\w+)\.set\s*\(/g
const MAP_GROWTH_DELETE_RE = /\.delete\s*\(/
const MAP_SIZE_CHECK_RE = /\.size\s*[><=!]/

type FunctionScope = {
  start: number
  end: number
  lines: string[]
  content: string
}

// Find function/method boundaries. Returns scopes with their content.
function findFunctionScopes(content: string): FunctionScope[] {
  const lines = content.split("\n")
  const scopes: FunctionScope[] = []
  let depth = 0
  let scopeStart = -1
  let isFunctionLike = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Detect function-like declarations (function, method, arrow)
    if (
      /(?!.*\b(?:if|for|while|switch|catch|class)\s*\()(?:function\s+\w+|(?:async\s+)?(?:\w+\s*\(|=>\s*\{)|\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{)/.test(
        line,
      ) &&
      depth === 0
    ) {
      isFunctionLike = true
      scopeStart = i
    }

    for (const ch of line) {
      if (ch === "{") {
        depth++
      } else if (ch === "}") {
        depth--
        if (depth === 0 && isFunctionLike && scopeStart >= 0) {
          const scopeLines = lines.slice(scopeStart, i + 1)
          scopes.push({
            start: scopeStart + 1,
            end: i + 1,
            lines: scopeLines,
            content: scopeLines.join("\n"),
          })
          isFunctionLike = false
          scopeStart = -1
        }
      }
    }
  }
  return scopes
}

function detectResourceLeaks(
  content: string,
  file: string,
  enabledTypes: Set<DebugEngine.LifecycleResourceType>,
  maxPerFile: number,
): DebugEngine.LifecycleFinding[] {
  const findings: DebugEngine.LifecycleFinding[] = []
  const scopes = findFunctionScopes(content)
  const allLines = content.split("\n")

  for (const scope of scopes) {
    if (findings.length >= maxPerFile) break

    for (const rule of RESOURCE_RULES) {
      if (!enabledTypes.has(rule.type)) continue
      if (findings.length >= maxPerFile) break

      // Find creation sites within this scope
      const createRe = new RegExp(rule.createRe.source, rule.createRe.flags)
      let match: RegExpExecArray | null
      while ((match = createRe.exec(scope.content)) !== null) {
        if (findings.length >= maxPerFile) break

        const lineInScope = scope.content.slice(0, match.index).split("\n").length
        const absoluteLine = scope.start + lineInScope - 1

        // Check if this line or the preceding line is suppressed
        if (SUPPRESS_RE.test(allLines[absoluteLine - 1] ?? "")) continue
        if (absoluteLine >= 2 && SUPPRESS_RE.test(allLines[absoluteLine - 2] ?? "")) continue

        // Check if any cleanup pattern exists in the same scope
        const hasCleanup = rule.cleanupPatterns.some((p) => p.test(scope.content))

        // For AbortController, `.signal` usage counts as passing it to
        // a dependent operation — that's valid cleanup.
        if (hasCleanup) continue

        // For event_listener: also check if the return value (unsub
        // function) is captured
        if (rule.type === "event_listener") {
          const createLine = allLines[absoluteLine - 1] ?? ""
          // If the return value is assigned, assume it's used for cleanup
          if (/(?:const|let|var)\s+\w+\s*=/.test(createLine)) continue
        }

        findings.push({
          file,
          line: absoluteLine,
          resourceType: rule.type,
          pattern: "no_cleanup",
          severity: rule.severity,
          description: rule.description,
          cleanupLocation: `within function scope (lines ${scope.start}-${scope.end})`,
        })
      }
    }
  }
  return findings
}

function detectUnboundedMapGrowth(content: string, file: string, maxPerFile: number): DebugEngine.LifecycleFinding[] {
  const findings: DebugEngine.LifecycleFinding[] = []
  const lines = content.split("\n")

  // Track Map identifiers that call .set() but never .delete() and
  // have no size check in the same file scope.
  const mapSetters = new Map<string, number[]>()
  for (let i = 0; i < lines.length; i++) {
    if (SUPPRESS_RE.test(lines[i])) continue
    const re = new RegExp(MAP_GROWTH_SET_RE.source, MAP_GROWTH_SET_RE.flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(lines[i])) !== null) {
      const name = match[1]
      // Skip common safe names
      if (name === "console" || name === "Math" || name === "JSON" || name === "process") continue
      const existing = mapSetters.get(name) ?? []
      existing.push(i + 1)
      mapSetters.set(name, existing)
    }
  }

  for (const [name, setLines] of mapSetters) {
    if (findings.length >= maxPerFile) break
    // Check if there's a corresponding .delete() or .size guard
    const hasDelete = content.includes(`${name}.delete(`)
    const hasSizeCheck = new RegExp(`${name}\\.size\\s*[><=!]`).test(content)
    const hasClear = content.includes(`${name}.clear(`)
    if (hasDelete || hasSizeCheck || hasClear) continue

    // Only flag if .set() appears in a function that could be called
    // repeatedly (heuristic: inside a function body, not at module top
    // level). Check if any set line is inside a function scope.
    const scopes = findFunctionScopes(content)
    const inFunction = setLines.some((ln) => scopes.some((s) => ln >= s.start && ln <= s.end))
    if (!inFunction) continue

    findings.push({
      file,
      line: setLines[0],
      resourceType: "map_growth",
      pattern: "unbounded_growth",
      severity: "medium",
      description: `Map/Set \`${name}\` grows via .set() (lines [${setLines.join(",")}]) but never .delete()/.clear() and has no .size guard. May grow without bounds in a hot path.`,
      cleanupLocation: null,
    })
  }
  return findings
}

async function scanFile(
  file: string,
  enabledTypes: Set<DebugEngine.LifecycleResourceType>,
  maxPerFile: number,
  preread?: string,
): Promise<DebugEngine.LifecycleFinding[]> {
  const content = preread ?? (await fs.readFile(file, "utf8").catch(() => ""))
  if (!content) return []

  const findings: DebugEngine.LifecycleFinding[] = []

  // Resource leak detection for standard resource types
  const standardTypes = new Set([...enabledTypes])
  standardTypes.delete("map_growth")
  if (standardTypes.size > 0) {
    findings.push(...detectResourceLeaks(content, file, standardTypes, maxPerFile))
  }

  // Unbounded map growth
  if (enabledTypes.has("map_growth") && findings.length < maxPerFile) {
    findings.push(...detectUnboundedMapGrowth(content, file, maxPerFile - findings.length))
  }

  return findings.slice(0, maxPerFile)
}

export async function detectLifecycleImpl(
  projectID: ProjectID,
  input: DetectLifecycleInput,
): Promise<DebugEngine.LifecycleReport> {
  const excludeTests = input.excludeTests ?? true
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES
  const maxPerFile = input.maxFindingsPerFile ?? DEFAULT_MAX_PER_FILE
  const resourceTypes: DebugEngine.LifecycleResourceType[] = input.resourceTypes ?? [
    "event_listener",
    "timer",
    "subscription",
    "abort_controller",
    "child_process",
    "map_growth",
  ]
  const enabledTypes = new Set(resourceTypes)
  const include = input.include ?? DEFAULT_INCLUDE
  const cwd = Instance.directory

  // Native fast-path: run entire detection in Rust
  if (!input.files) {
    const native = nativeDetectLifecycle({ cwd, include, patterns: resourceTypes, maxFiles, maxPerFile, excludeTests })
    if (native) {
      return {
        findings: native.findings.map((f) => ({
          file: path.join(cwd, f.file),
          line: f.line,
          resourceType: f.resourceType as DebugEngine.LifecycleResourceType,
          pattern: f.pattern as DebugEngine.LifecyclePattern,
          severity: f.severity as DebugEngine.LifecycleFinding["severity"],
          description: f.description,
          cleanupLocation: f.cleanupLocation,
        })),
        filesScanned: native.filesScanned,
        truncated: native.truncated,
        explain: DebugEngine.buildExplain("detect-lifecycle", [], native.heuristics),
      }
    }
  }

  // JS fallback
  const heuristics: string[] = [`resourceTypes=${resourceTypes.join(",")}`]
  if (excludeTests) heuristics.push("exclude-tests")

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
  const findings: DebugEngine.LifecycleFinding[] = []
  if (preread) {
    for (const f of filesToScan) {
      const content = preread.get(f)
      if (!content) continue
      findings.push(...(await scanFile(f, enabledTypes, maxPerFile, content)))
    }
  } else {
    for (let i = 0; i < filesToScan.length; i += CONCURRENCY) {
      const batch = filesToScan.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map((f) => scanFile(f, enabledTypes, maxPerFile)))
      for (const r of results) findings.push(...r)
    }
  }

  // Sort: severity desc, then file, then line
  const severityRank: Record<DebugEngine.LifecycleFinding["severity"], number> = {
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
    explain: DebugEngine.buildExplain("detect-lifecycle", [], heuristics),
  }
}
