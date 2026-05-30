import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./glob.txt"
import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { NativePerf } from "../perf/native"
import { NativeAddon } from "../native/addon"
import { normalizeToWorkspacePath, resolveToolFilePath } from "./file-path"
import { parseNativeJsonArray } from "../util/native-json"

const NativeGlobEntry = z.object({
  path: z.string(),
  mtime: z.number(),
  size: z.number(),
})

export type NativeGlobEntry = z.infer<typeof NativeGlobEntry>

export function parseNativeGlobEntries(json: string): NativeGlobEntry[] {
  return parseNativeJsonArray(json, NativeGlobEntry, "Invalid native glob output")
}

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe(
        `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
      ),
  }),
  async execute(params, ctx) {
    if (params.path !== undefined) resolveToolFilePath(params.path, Instance.directory)
    if (params.pattern.includes("\x00")) throw new Error("Glob pattern contains null byte")
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
      },
    })

    let search = params.path ?? Instance.directory
    search = resolveToolFilePath(search, Instance.directory)
    await assertExternalDirectory(ctx, search, { kind: "directory" })
    await assertSymlinkInsideProject(search)
    const title = normalizeToWorkspacePath(search, Instance.worktree)

    // Native fast-path: in-process glob via Rust addon
    const native = NativeAddon.fs()
    if (native) {
      try {
        const json = NativePerf.run("fs.globFiles", { search, pattern: params.pattern, limit: 100 }, () =>
          native.globFiles(search, params.pattern, 100),
        )
        const entries = parseNativeGlobEntries(json).filter(
          (item) =>
            !Filesystem.contains(Instance.directory, search) || Filesystem.contains(Instance.directory, item.path),
        )
        entries.sort((a, b) => b.mtime - a.mtime)

        const output = []
        const truncated = entries.length >= 100
        if (entries.length === 0) output.push("No files found")
        if (entries.length > 0) {
          output.push(...entries.map((f) => f.path))
        }
        if (truncated) {
          output.push("")
          output.push("(Results are truncated: showing first 100 results...)")
        }

        return {
          title,
          metadata: {
            count: entries.length,
            truncated,
          },
          output: output.join("\n"),
        }
      } catch (e: any) {
        if (e?.code !== "MODULE_NOT_FOUND" && e?.code !== "ERR_MODULE_NOT_FOUND" && !(e instanceof SyntaxError)) throw e
      }
    }

    const limit = 100
    const files = []
    let truncated = false
    for await (const file of Ripgrep.files({
      cwd: search,
      glob: [params.pattern],
      signal: ctx.abort,
    })) {
      if (files.length >= limit) {
        truncated = true
        break
      }
      const full = path.resolve(search, file)
      const stats = Filesystem.stat(full)?.mtime?.getTime() ?? 0
      files.push({
        path: full,
        mtime: stats,
      })
    }
    files.sort((a, b) => b.mtime - a.mtime)

    const output = []
    if (files.length === 0) output.push("No files found")
    if (files.length > 0) {
      output.push(...files.map((f) => f.path))
      if (truncated) {
        output.push("")
        output.push(
          `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
        )
      }
    }

    return {
      title,
      metadata: {
        count: files.length,
        truncated,
      },
      output: output.join("\n"),
    }
  },
})
