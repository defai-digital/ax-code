import { createRequire } from "node:module"
import { Flag } from "../flag/flag"
import { NativePerf } from "../perf/native"
import { Log } from "../util/log"

const log = Log.create({ service: "debug-engine.native-scan" })
const _require = createRequire(import.meta.url)

export interface ScanPattern {
  label: string
  regex: string
  id: string
}

export interface ScanMatch {
  file: string
  line: number
  column: number
  text: string
  label: string
  id: string
  contextBefore: string[]
  contextAfter: string[]
}

export interface ScanResult {
  matches: ScanMatch[]
  filesScanned: number
  elapsedMs: number
}

/**
 * Calls the native @ax-code/fs scan_files function if available.
 */
export function nativeScanFiles(input: {
  cwd: string
  include: string[]
  patterns: ScanPattern[]
  maxFiles?: number
  maxPerFile?: number
  contextLines?: number
}): ScanResult | undefined {
  if (!Flag.AX_CODE_NATIVE_FS) return undefined
  try {
    const native = _require("@ax-code/fs")
    const json = NativePerf.run(
      "fs.scanFiles",
      {
        cwd: input.cwd,
        include: input.include.length,
        patterns: input.patterns.length,
        maxFiles: input.maxFiles ?? 500,
        maxPerFile: input.maxPerFile ?? 20,
        contextLines: input.contextLines ?? 0,
      },
      () =>
        native.scanFiles(
          input.cwd,
          JSON.stringify({
            include: input.include,
            patterns: input.patterns,
            maxFiles: input.maxFiles ?? 500,
            maxPerFile: input.maxPerFile ?? 20,
            contextLines: input.contextLines ?? 0,
          }),
        ),
    )
    return JSON.parse(json) as ScanResult
  } catch (e: any) {
    if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND" && !(e instanceof SyntaxError)) {
      log.warn("native scan_files failed, falling back to JS", { error: e })
    }
    return undefined
  }
}

/**
 * Reads multiple files in parallel using the native @ax-code/fs addon.
 */
export function nativeReadFilesBatch(files: string[]): Map<string, string> | undefined {
  if (!Flag.AX_CODE_NATIVE_FS) return undefined
  if (files.length === 0) return new Map()
  try {
    const native = _require("@ax-code/fs")
    const json = NativePerf.run("fs.readFilesBatch", { files: files.length }, () =>
      native.readFilesBatch(JSON.stringify(files)),
    )
    const pairs: [string, string][] = JSON.parse(json)
    return new Map(pairs)
  } catch (e: any) {
    if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND" && !(e instanceof SyntaxError)) {
      log.warn("native read_files_batch failed, falling back to JS", { error: e })
    }
    return undefined
  }
}

// ─── Full native detector calls ────────────────────────────────────

interface DetectInput {
  cwd: string
  include: string[]
  patterns: string[]
  maxFiles?: number
  maxPerFile?: number
  excludeTests?: boolean
}

interface DetectResult<F> {
  findings: F[]
  filesScanned: number
  truncated: boolean
  elapsedMs: number
  heuristics: string[]
}

function callNativeDetector<F>(fnName: string, input: DetectInput): DetectResult<F> | undefined {
  if (!Flag.AX_CODE_NATIVE_FS) return undefined
  try {
    const native = _require("@ax-code/fs")
    if (typeof native[fnName] !== "function") return undefined
    const json = NativePerf.run(
      `fs.${fnName}`,
      {
        cwd: input.cwd,
        include: input.include.length,
        patterns: input.patterns.length,
        maxFiles: input.maxFiles ?? 500,
        maxPerFile: input.maxPerFile ?? 20,
        excludeTests: input.excludeTests ?? true,
      },
      () =>
        native[fnName](
          JSON.stringify({
            cwd: input.cwd,
            include: input.include,
            patterns: input.patterns,
            maxFiles: input.maxFiles ?? 500,
            maxPerFile: input.maxPerFile ?? 20,
            excludeTests: input.excludeTests ?? true,
          }),
        ),
    )
    return JSON.parse(json) as DetectResult<F>
  } catch (e: any) {
    if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND" && !(e instanceof SyntaxError)) {
      log.warn(`native ${fnName} failed, falling back to JS`, { error: e })
    }
    return undefined
  }
}

export interface NativeSecurityFinding {
  file: string
  line: number
  pattern: string
  severity: string
  description: string
  userControlled: boolean
}

export function nativeDetectSecurity(input: DetectInput): DetectResult<NativeSecurityFinding> | undefined {
  return callNativeDetector("detectSecurity", input)
}

export interface NativeLifecycleFinding {
  file: string
  line: number
  resourceType: string
  pattern: string
  severity: string
  description: string
  cleanupLocation: string | null
}

export function nativeDetectLifecycle(input: DetectInput): DetectResult<NativeLifecycleFinding> | undefined {
  return callNativeDetector("detectLifecycle", input)
}

export interface NativeHardcodeFinding {
  file: string
  line: number
  column: number
  kind: string
  value: string
  suggestion: string
  severity: string
}

export function nativeDetectHardcodes(input: DetectInput): DetectResult<NativeHardcodeFinding> | undefined {
  return callNativeDetector("detectHardcodes", input)
}
