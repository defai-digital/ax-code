import z from "zod"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { Process } from "../util/process"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import { fileToolGuard } from "./external-directory"
import { clampGrepLine } from "./grep-line"
import { decodeGrepPath } from "./grep-path"
import { NativePerf } from "../perf/native"
import { NativeAddon } from "../native/addon"
import { runNativeScan } from "../native/scan"
import { Env } from "@/util/env"
import { resolveToolFilePath } from "./file-path"
import { parseNativeJsonArray } from "../util/native-json"
import { errorCode } from "@/util/error-message"
import { CanonicalOutput } from "./canonical-output"
import { searchWithContext } from "./grep-context"
import { readGrepOutput } from "./grep-output"
import { parseJsonStrict } from "../util/json-value"

const RipgrepText = z.union([z.object({ text: z.string() }), z.object({ bytes: z.string() })])
const RipgrepEvent = z.object({ type: z.string() }).passthrough()
const RipgrepMatch = z.object({
  data: z.object({ path: RipgrepText, lines: RipgrepText, line_number: z.number().int().positive() }),
})
const RipgrepEnd = z.object({ data: z.object({ binary_offset: z.number().nullish() }) })
const decodeRipgrepText = (value: z.infer<typeof RipgrepText>) =>
  "text" in value ? value.text : Buffer.from(value.bytes, "base64").toString("utf8")

const NativeSearchMatch = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number(),
  matchText: z.string(),
})

export type NativeSearchMatch = z.infer<typeof NativeSearchMatch>

export function parseNativeSearchMatches(json: string): NativeSearchMatch[] {
  return parseNativeJsonArray(json, NativeSearchMatch, "Invalid native search output")
}

export function parseRipgrepLineNumber(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

const RESULT_LIMIT = 100

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z
      .string()
      .optional()
      .describe("The file or directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
    context: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe(
        "Lines before and after matches (0-10). Use for definitions or callers to avoid a separate read. Defaults to 0.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum matching lines (1-100). Defaults to 20 with context, otherwise 100."),
  }),
  concurrencySafe: () => true,
  outputSchema: CanonicalOutput.Grep,
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }
    if (params.path !== undefined) resolveToolFilePath(params.path, Instance.directory)
    if (params.pattern.includes("\x00")) throw new Error("Pattern contains null byte")
    if (params.include?.includes("\x00")) throw new Error("Include pattern contains null byte")

    let searchPath = params.path ?? Instance.directory
    const isFile = Filesystem.stat(resolveToolFilePath(searchPath, Instance.directory))?.isFile() === true
    searchPath = await fileToolGuard(ctx, searchPath, { kind: isFile ? "file" : "directory" })

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
        context: params.context,
        limit: params.limit,
      },
    })
    ctx.abort.throwIfAborted()

    const limit = params.limit ?? (params.context ? 20 : RESULT_LIMIT)
    if (params.context)
      return searchWithContext({ ...params, path: searchPath, limit, context: params.context, isFile }, ctx.abort)
    const scanLimit = limit + 1

    // Older addons use the cancellable subprocess path, never a synchronous scan.
    const native = NativeAddon.fs()
    if (native?.searchContentAsync && native.ScanCancellation && !(isFile && params.include)) {
      try {
        const json = await NativePerf.runAsync(
          "fs.searchContent",
          {
            searchPath,
            pattern: params.pattern,
            glob: params.include ? 1 : 0,
            limit: scanLimit,
          },
          () =>
            runNativeScan(
              () => new native.ScanCancellation(),
              (cancellation) =>
                native.searchContentAsync(
                  searchPath,
                  params.pattern,
                  JSON.stringify({
                    glob: params.include,
                    limit: scanLimit,
                    contextLines: 0,
                  }),
                  cancellation,
                ),
              ctx.abort,
            ),
        )
        // Schema matches `SearchMatch` in crates/ax-code-fs/src/lib.rs.
        // `path` is absolute so `Filesystem.contains` works, and `line` +
        // `matchText` are the field names the native emits. `modTime` was
        // never populated and its old sort was a no-op — dropped.
        const rawMatches = parseNativeSearchMatches(json)
        const matches = rawMatches.filter(
          (match) =>
            !Filesystem.contains(Instance.directory, searchPath) || Filesystem.contains(Instance.directory, match.path),
        )
        const scanCapped = rawMatches.length >= scanLimit
        const truncated = scanCapped || matches.length > limit
        const visibleMatches = truncated ? matches.slice(0, limit) : matches

        if (visibleMatches.length === 0) {
          return {
            title: params.pattern,
            metadata: { matches: 0, truncated },
            data: { matches: [], truncated },
            output: truncated
              ? "No visible matches found before the search limit; narrow the path or pattern."
              : "No files found",
          }
        }

        // Report the pre-truncation count like the ripgrep path below —
        // `visibleMatches.length` would always read limit when
        // truncated, understating how many matches were actually found.
        // The native scan stops at scanLimit, so when the raw scan
        // hit that cap the true total is unknown — report a lower bound
        // instead of presenting the capped number as the exact count.
        const totalMatches = matches.length
        const countLabel = scanCapped ? `${totalMatches}+` : `${totalMatches}`
        const outputLines = [
          `Found ${countLabel} matches${truncated ? ` (showing first ${visibleMatches.length})` : ""}`,
        ]
        let currentFile = ""
        for (const match of visibleMatches) {
          if (currentFile !== match.path) {
            if (currentFile !== "") outputLines.push("")
            currentFile = match.path
            outputLines.push(`${match.path}:`)
          }
          const line = clampGrepLine(match.matchText)
          const truncatedLineText = line + (line.length < match.matchText.length ? "..." : "")
          outputLines.push(`  Line ${match.line}: ${truncatedLineText}`)
        }

        return {
          title: params.pattern,
          data: {
            matches: visibleMatches.map((match) => ({
              path: match.path,
              line: match.line,
              text: clampGrepLine(match.matchText),
            })),
            truncated,
          },
          metadata: {
            matches: totalMatches,
            truncated,
          },
          output: outputLines.join("\n"),
        }
      } catch (e: unknown) {
        const code = errorCode(e)
        if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND" || e instanceof SyntaxError) {
          /* fall through to ripgrep */
        } else throw e
      }
    }

    const rgPath = await Ripgrep.filepath()
    // JSON frames filenames, source text, and binary-file diagnostics without
    // letting a warning or a control character consume another file's record.
    const args = ["--json", "--hidden", "--no-messages", "--regexp", params.pattern]
    // Preserve source line boundaries: binary conversion can replace NUL with
    // newlines when ripgrep searches an explicitly named file.
    if (isFile) args.push("--text")
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push("--", searchPath)
    const commandTimeoutMs = 120_000

    const proc = Process.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      abort: ctx.abort,
      env: Env.sanitize(),
      timeout: commandTimeoutMs,
    })

    const { output, errorOutput, exitCode, capped: outputCapped } = await readGrepOutput(proc, ctx.abort)
    if (!outputCapped && exitCode === 124) {
      throw new Error(`grep command timed out after ${commandTimeoutMs / 1000}s`)
    }
    if (!outputCapped && proc.signalCode) throw new Error(`ripgrep terminated by signal ${proc.signalCode}`)

    // Exit codes: 0 = matches found, 1 = no matches, 2 = errors (but may still have matches)
    // With --no-messages, we suppress error output but still get exit code 2 for broken symlinks etc.
    // An error with no results is not evidence that no matches exist.
    if (!outputCapped && exitCode === 1) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        data: { matches: [], truncated: false },
        output: "No files found",
      }
    }

    if (!outputCapped && ((exitCode !== 0 && exitCode !== 2) || (exitCode === 2 && !output))) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const hasErrors = !outputCapped && exitCode === 2

    const matches = []
    let skippedRecords = false
    let incompleteRecord = false
    let summarySeen = false
    let binaryStopped = false
    // mtime is only needed once per file for sorting, but ripgrep emits one
    // line per match — wide searches would otherwise stat the same file
    // hundreds of times.
    const mtimeCache = new Map<string, number | undefined>()

    for (let offset = 0; offset < output.length; ) {
      const lineEnd = output.indexOf("\n", offset)
      // Both capture cutoff and a prematurely closed pipe can leave a partial
      // JSON record. Never turn it into a result or an unreadable-file warning.
      if (lineEnd === -1) {
        incompleteRecord = true
        break
      }
      const line = output.slice(offset, lineEnd)
      offset = lineEnd + 1
      if (!line.trim()) continue
      const event = RipgrepEvent.parse(parseJsonStrict(line))
      if (event.type === "summary") summarySeen = true
      // An explicitly named file is searched through binary data. Directory
      // traversal stops that file early; binary_offset alone means detection.
      if (event.type === "end" && !isFile && RipgrepEnd.parse(event).data.binary_offset != null) binaryStopped = true
      if (event.type !== "match") continue
      const record = RipgrepMatch.parse(event).data
      const filePath = decodeGrepPath(record.path)
      if (filePath === undefined) {
        skippedRecords = true
        continue
      }
      const lineNum = record.line_number
      const lineText = decodeRipgrepText(record.lines).replace(/\r?\n$/, "")

      let modTime = mtimeCache.get(filePath)
      if (modTime === undefined && !mtimeCache.has(filePath)) {
        modTime = Filesystem.stat(filePath)?.mtime?.getTime()
        mtimeCache.set(filePath, modTime)
      }
      if (modTime === undefined) {
        skippedRecords = true
        continue
      }

      matches.push({
        path: filePath,
        modTime,
        lineNum,
        lineText,
      })
    }

    matches.sort((a, b) => b.modTime - a.modTime)
    if (hasErrors && !matches.length) throw new Error(`ripgrep failed: ${errorOutput}`)

    const resultCapped = matches.length > limit
    // Process may close stdout before its end event after child exit. A complete
    // protocol summary proves completion; any missing or cut frame does not.
    const streamIncomplete = incompleteRecord || !summarySeen
    const partial = outputCapped || streamIncomplete || binaryStopped
    const truncated = resultCapped || hasErrors || skippedRecords || partial
    const finalMatches = matches.slice(0, limit)

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated },
        data: { matches: [], truncated },
        output: truncated ? "No visible matches found; some search results were unavailable." : "No files found",
      }
    }

    const totalMatches = matches.length
    const outputLines = [
      `Found ${totalMatches}${partial ? "+" : ""} matches${resultCapped ? ` (showing first ${limit})` : ""}`,
    ]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const line = clampGrepLine(match.lineText)
      const truncatedLineText = line + (line.length < match.lineText.length ? "..." : "")
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (resultCapped) {
      outputLines.push("")
      outputLines.push(
        `(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`,
      )
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }
    if (skippedRecords) outputLines.push("", "(Some search results could not be read and were skipped)")
    if (binaryStopped) outputLines.push("", "(Binary data stopped part of the search)")
    if (streamIncomplete && !outputCapped)
      outputLines.push("", "(Search output ended before all results were received)")
    if (outputCapped)
      outputLines.push(
        "",
        "(Search capture limit reached; ordering covers captured results only. Narrow the path or pattern.)",
      )

    return {
      title: params.pattern,
      data: {
        matches: matches
          .slice(0, limit)
          .map((match) => ({ path: match.path, line: match.lineNum, text: clampGrepLine(match.lineText) })),
        truncated,
      },
      metadata: {
        matches: totalMatches,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})
