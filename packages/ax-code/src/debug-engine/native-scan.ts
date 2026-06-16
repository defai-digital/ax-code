import { NativePerf } from "../perf/native"
import { Log } from "../util/log"
import { NativeAddon } from "../native/addon"
import { Flag } from "../flag/flag"
import z from "zod"
import { parseNativeJson } from "../util/native-json"

const log = Log.create({ service: "debug-engine.native-scan" })

function nativeScanEnabled() {
  return Flag.AX_CODE_DEBUG_ENGINE_NATIVE_SCAN
}

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

const NativeScanMatch = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number(),
  text: z.string(),
  label: z.string(),
  id: z.string(),
  contextBefore: z.array(z.string()),
  contextAfter: z.array(z.string()),
})

const NativeScanResult = z.object({
  matches: z.array(NativeScanMatch),
  filesScanned: z.number(),
  elapsedMs: z.number(),
})

const NativeReadFilesBatchResult = z.array(z.tuple([z.string(), z.string()]))

const NativeDetectResult = z.object({
  findings: z.array(z.unknown()),
  filesScanned: z.number(),
  truncated: z.boolean(),
  elapsedMs: z.number(),
  heuristics: z.array(z.string()),
})

export function parseNativeScanResult(json: string): ScanResult {
  return parseNativeJson(json, NativeScanResult, "Invalid native scan result")
}

export function parseNativeReadFilesBatchResult(json: string): Array<[string, string]> {
  return parseNativeJson(json, NativeReadFilesBatchResult, "Invalid native read files batch result")
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
  if (!nativeScanEnabled()) return undefined
  const native = NativeAddon.fs()
  if (!native) return undefined
  try {
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
    return parseNativeScanResult(json)
  } catch (e: any) {
    log.warn("native scan_files failed, falling back to JS", { error: e })
    return undefined
  }
}

/**
 * Reads multiple files in parallel using the native @ax-code/fs addon.
 */
export function nativeReadFilesBatch(files: string[]): Map<string, string> | undefined {
  if (files.length === 0) return new Map()
  if (!nativeScanEnabled()) return undefined
  const native = NativeAddon.fs()
  if (!native) return undefined
  try {
    const json = NativePerf.run("fs.readFilesBatch", { files: files.length }, () =>
      native.readFilesBatch(JSON.stringify(files)),
    )
    const pairs = parseNativeReadFilesBatchResult(json)
    return new Map(pairs)
  } catch (e: any) {
    log.warn("native read_files_batch failed, falling back to JS", { error: e })
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

export function parseNativeDetectResult<F>(json: string): DetectResult<F> {
  return parseNativeJson(json, NativeDetectResult, "Invalid native detector result") as DetectResult<F>
}

function callNativeDetector<F>(fnName: string, input: DetectInput): DetectResult<F> | undefined {
  if (!nativeScanEnabled()) return undefined
  const native = NativeAddon.fs() as Record<string, unknown> | undefined
  if (!native) return undefined
  if (typeof native[fnName] !== "function") return undefined
  try {
    const fn = native[fnName] as (json: string) => string
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
        fn(
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
    return parseNativeDetectResult<F>(json)
  } catch (e: any) {
    log.warn(`native ${fnName} failed, falling back to JS`, { error: e })
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
