import path from "path"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import { uniqueStrings } from "../util/string-list"
import { nativeReadFilesBatch } from "./native-scan"

// Defaults shared by all detect-* scanners. The pattern set covers
// every TS/JS variant the codebase ships; the exclude list mirrors
// the dirs that other scan paths (grep, glob) ignore.
const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"]
const DEFAULT_EXCLUDE_DIRS = ["node_modules", "dist", "build", ".cache", ".git", ".next", "coverage"]
const SCANNER_READ_CONCURRENCY = 8
const DEFAULT_MAX_FILES = 500
const DEFAULT_MAX_PER_FILE = 20

export type ScannerScopeControls = {
  scope?: "worktree" | "none"
  excludeTests?: boolean
}

export type ScannerInputControls = ScannerScopeControls & {
  include?: string[]
  // Pre-resolved file list for incremental scanning.
  files?: string[]
  // Hard cap on files inspected; when hit, output is marked truncated.
  maxFiles?: number
  // Cap per file; prevents one huge generated file from dominating the
  // result set.
  maxFindingsPerFile?: number
}

export function scannerScopeDisabled(input: ScannerScopeControls): boolean {
  return input.scope === "none"
}

export function scannerUsesIncrementalFiles(input: { files?: string[] }): input is { files: string[] } {
  return input.files !== undefined
}

type ScannerFileBatch = {
  files: string[]
  candidateFileCount: number
  incremental: boolean
  truncated: boolean
}

type ScannerFinding = {
  severity: "high" | "medium" | "low"
  file: string
  line: number
}

const SCANNER_SEVERITY_RANK: Record<ScannerFinding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export function resolveScannerDefaults(input: {
  excludeTests?: boolean
  maxFiles?: number
  maxFindingsPerFile?: number
  include?: string[]
}) {
  return {
    excludeTests: input.excludeTests ?? true,
    maxFiles: input.maxFiles ?? DEFAULT_MAX_FILES,
    maxPerFile: input.maxFindingsPerFile ?? DEFAULT_MAX_PER_FILE,
    include: input.include ?? DEFAULT_INCLUDE,
  }
}

export async function collectScannerFiles(
  input: { files?: string[] },
  options: { cwd: string; include: string[]; excludeTests: boolean },
) {
  if (scannerUsesIncrementalFiles(input)) {
    return {
      incremental: true,
      files: uniqueStrings(
        input.files
          .map((file) => resolveScannerFile(file, options.cwd))
          .filter((file) => {
            if (isExcludedDir(file, options.cwd)) return false
            if (options.excludeTests && isTestFile(file)) return false
            return Instance.containsPath(file)
          }),
      ),
    }
  }

  const files: string[] = []
  for (const pattern of options.include) {
    const hits = await Glob.scan(pattern, { cwd: options.cwd, absolute: true, dot: false, symlink: false })
    for (const file of hits) {
      if (isExcludedDir(file, options.cwd)) continue
      if (options.excludeTests && isTestFile(file)) continue
      if (!Instance.containsPath(file)) continue
      files.push(file)
    }
  }

  return {
    incremental: false,
    files: uniqueStrings(files),
  }
}

export async function collectScannerFileBatch(
  input: { files?: string[] },
  options: { cwd: string; include: string[]; excludeTests: boolean; maxFiles: number },
): Promise<ScannerFileBatch> {
  const collected = await collectScannerFiles(input, options)
  const files = collected.files.slice(0, options.maxFiles)

  return {
    files,
    candidateFileCount: collected.files.length,
    incremental: collected.incremental,
    truncated: collected.files.length > options.maxFiles,
  }
}

export function scannerFileBatchHeuristics(fileBatch: ScannerFileBatch): string[] {
  const heuristics: string[] = []
  if (fileBatch.incremental) heuristics.push("incremental")
  heuristics.push(`candidate-files=${fileBatch.candidateFileCount}`)
  if (fileBatch.truncated) heuristics.push("file-cap-hit")
  return heuristics
}

export function sortScannerFindings<T extends ScannerFinding>(findings: T[]): T[] {
  return findings.sort((a, b) => {
    if (SCANNER_SEVERITY_RANK[a.severity] !== SCANNER_SEVERITY_RANK[b.severity]) {
      return SCANNER_SEVERITY_RANK[a.severity] - SCANNER_SEVERITY_RANK[b.severity]
    }
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return a.line - b.line
  })
}

export async function scanScannerFiles<T>(
  files: string[],
  scanFile: (file: string, preread?: string) => Promise<T[]>,
  options: { readFilesBatch?: (files: string[]) => Map<string, string> | undefined } = {},
): Promise<{ findings: T[]; usedNativeBatchRead: boolean }> {
  const readFilesBatch = options.readFilesBatch ?? nativeReadFilesBatch
  const preread = readFilesBatch(files)
  const findings: T[] = []

  if (preread) {
    for (const file of files) {
      const content = preread.get(file)
      if (content === undefined) continue
      findings.push(...(await scanFile(file, content)))
    }
    return { findings, usedNativeBatchRead: true }
  }

  for (let i = 0; i < files.length; i += SCANNER_READ_CONCURRENCY) {
    const batch = files.slice(i, i + SCANNER_READ_CONCURRENCY)
    const results = await Promise.all(batch.map((file) => scanFile(file)))
    for (const result of results) findings.push(...result)
  }

  return { findings, usedNativeBatchRead: false }
}

export function isTestFile(file: string): boolean {
  return /(^|[\\/])(test|tests|__tests__|__mocks__|spec)[\\/]/.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
}

export function resolveScannerFile(file: string, cwd: string): string {
  return path.isAbsolute(file) ? file : path.resolve(cwd, file)
}

function isExcludedDir(file: string, cwd: string): boolean {
  const rel = path.relative(cwd, file)
  const segments = rel.split(path.sep)
  return segments.some((seg) => DEFAULT_EXCLUDE_DIRS.includes(seg))
}
