import z from "zod"
import { text } from "node:stream/consumers"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { Process } from "../util/process"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { MAX_LINE_LENGTH } from "@/constants/tool"
import { NativePerf } from "../perf/native"
import { NativeAddon } from "../native/addon"

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }
    if (params.path?.includes("\x00")) throw new Error("File path contains null byte")

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })
    await assertSymlinkInsideProject(searchPath)

    // Native fast-path: in-process search via Rust addon
    const native = NativeAddon.fs()
    if (native) {
      try {
        const json = NativePerf.run(
          "fs.searchContent",
          {
            searchPath,
            pattern: params.pattern,
            glob: params.include ? 1 : 0,
            limit: 100,
          },
          () =>
            native.searchContent(
              searchPath,
              params.pattern,
              JSON.stringify({
                glob: params.include,
                limit: 100,
                contextLines: 0,
              }),
            ),
        )
        // Schema matches `SearchMatch` in crates/ax-code-fs/src/lib.rs.
        // `path` is absolute so `Filesystem.contains` works, and `line` +
        // `matchText` are the field names the native emits. `modTime` was
        // never populated and its old sort was a no-op — dropped.
        const matches = (
          JSON.parse(json) as Array<{ path: string; line: number; column: number; matchText: string }>
        ).filter(
          (match) =>
            !Filesystem.contains(Instance.directory, searchPath) || Filesystem.contains(Instance.directory, match.path),
        )

        if (matches.length === 0) {
          return {
            title: params.pattern,
            metadata: { matches: 0, truncated: false },
            output: "No files found",
          }
        }

        const totalMatches = matches.length
        const outputLines = [`Found ${totalMatches} matches`]
        let currentFile = ""
        for (const match of matches) {
          if (currentFile !== match.path) {
            if (currentFile !== "") outputLines.push("")
            currentFile = match.path
            outputLines.push(`${match.path}:`)
          }
          const truncatedLineText =
            match.matchText.length > MAX_LINE_LENGTH
              ? match.matchText.substring(0, MAX_LINE_LENGTH) + "..."
              : match.matchText
          outputLines.push(`  Line ${match.line}: ${truncatedLineText}`)
        }

        return {
          title: params.pattern,
          metadata: {
            matches: totalMatches,
            truncated: totalMatches >= 100,
          },
          output: outputLines.join("\n"),
        }
      } catch (e: any) {
        if (e?.code === "MODULE_NOT_FOUND" || e?.code === "ERR_MODULE_NOT_FOUND") {
          /* fall through to ripgrep */
        } else throw e
      }
    }

    const rgPath = await Ripgrep.filepath()
    // Use the ASCII Unit Separator (0x1f) as the field separator
    // instead of `|`. `|` is a valid filename character on Unix, so a
    // path like `foo|bar.ts` would corrupt the split. 0x1f is a
    // control character that cannot appear in typical file paths,
    // line numbers, or source code, and Node's child_process allows
    // it (it only rejects NUL/0x00 in argv). Ripgrep treats it as a
    // literal byte separator.
    const FIELD_SEP = "\x1f"
    const args = [
      "-nH",
      "--hidden",
      "--no-messages",
      `--field-match-separator=${FIELD_SEP}`,
      "--regexp",
      params.pattern,
    ]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const proc = Process.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      abort: ctx.abort,
    })

    let output: string
    let errorOutput: string
    let exitCode: number
    try {
      if (!proc.stdout || !proc.stderr) {
        throw new Error("Process output not available")
      }
      output = await text(proc.stdout)
      errorOutput = await text(proc.stderr)
      exitCode = await proc.exited
    } catch (err) {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGTERM")
      throw err
    }

    // Exit codes: 0 = matches found, 1 = no matches, 2 = errors (but may still have matches)
    // With --no-messages, we suppress error output but still get exit code 2 for broken symlinks etc.
    // Only fail if exit code is 2 AND no output was produced
    if (exitCode === 1 || (exitCode === 2 && !output.trim())) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0 && exitCode !== 2) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const hasErrors = exitCode === 2

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = output.trim().split(/\r?\n/)
    const matches = []

    for (const line of lines) {
      if (!line) continue

      const [filePath, lineNumStr, ...lineTextParts] = line.split(FIELD_SEP)
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

      const lineNum = parseInt(lineNumStr, 10)
      if (isNaN(lineNum)) continue
      // Rejoin on the field separator so matched lines that happened
      // to contain 0x1f reconstruct correctly (edge case for binary
      // files or terminal escape sequences).
      const lineText = lineTextParts.join(FIELD_SEP)

      const stats = Filesystem.stat(filePath)
      if (!stats) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const totalMatches = matches.length
    const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push(
        `(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`,
      )
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: totalMatches,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})
