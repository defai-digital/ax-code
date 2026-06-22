import z from "zod"
import { Tool } from "./tool"
import * as path from "path"
import fs from "fs/promises"
import { minimatch } from "minimatch"
import DESCRIPTION from "./ls.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory, assertSymlinkInsideProject } from "./external-directory"
import { normalizeToWorkspacePath, resolveToolFilePath } from "./file-path"

const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
]

const LIMIT = 100
type ListedEntry = {
  path: string
  type: "directory" | "file"
}
type IgnoreRule = {
  pattern: string
  prefix: boolean
}

function toSlashPath(value: string) {
  return value.split(path.sep).join("/")
}

function matchesIgnore(rule: IgnoreRule, entry: ListedEntry) {
  const pattern = rule.pattern
  const normalized = pattern.replaceAll("\\", "/")
  const rel = entry.path
  if (normalized.endsWith("/")) {
    const dir = normalized.slice(0, -1)
    return rel === dir || rel.startsWith(`${dir}/`)
  }
  if (rel === normalized || rel.startsWith(`${normalized}/`)) return true
  if (minimatch(rel, normalized, { dot: true })) return true
  return rule.prefix && minimatch(rel, `${normalized}*`, { dot: true })
}

async function listEntries(root: string, ignore: string[] | undefined, signal: AbortSignal) {
  const ignored: IgnoreRule[] = IGNORE_PATTERNS.map((pattern) => ({ pattern, prefix: true })).concat(
    (ignore ?? []).map((pattern) => ({ pattern, prefix: false })),
  )
  const entries: ListedEntry[] = []
  const stack = [""]
  let truncated = false

  while (stack.length > 0) {
    signal.throwIfAborted()
    const dir = stack.pop()!
    const fullDir = path.join(root, dir)
    const children = await fs.readdir(fullDir, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name))

    for (const child of children) {
      signal.throwIfAborted()
      const rel = toSlashPath(path.join(dir, child.name))
      const type = child.isDirectory() ? "directory" : "file"
      const entry: ListedEntry = { path: rel, type }
      if (ignored.some((rule) => matchesIgnore(rule, entry))) continue

      entries.push(entry)
      if (entries.length >= LIMIT) {
        truncated = true
        return { entries, truncated }
      }

      if (type === "directory") stack.push(rel)
    }
  }

  return { entries, truncated }
}

export const ListTool = Tool.define("list", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().describe("The absolute path to the directory to list (must be absolute, not relative)").optional(),
    ignore: z.array(z.string()).describe("List of glob patterns to ignore").optional(),
  }),
  async execute(params, ctx) {
    const searchPath = resolveToolFilePath(params.path ?? Instance.directory, Instance.directory)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })
    await assertSymlinkInsideProject(searchPath)

    await ctx.ask({
      permission: "list",
      patterns: [searchPath],
      always: ["*"],
      metadata: {
        path: searchPath,
      },
    })

    const { entries, truncated } = await listEntries(searchPath, params.ignore, ctx.abort)

    // Build directory structure
    const dirs = new Set<string>()
    const filesByDir = new Map<string, string[]>()

    for (const entry of entries) {
      const dir = entry.type === "directory" ? entry.path : path.dirname(entry.path)
      const parts = dir === "." ? [] : dir.split("/")

      // Add all parent directories
      for (let i = 0; i <= parts.length; i++) {
        const dirPath = i === 0 ? "." : parts.slice(0, i).join("/")
        dirs.add(dirPath)
      }

      // Add file to its directory
      if (entry.type === "directory") continue
      const file = entry.path
      if (!filesByDir.has(dir)) filesByDir.set(dir, [])
      filesByDir.get(dir)!.push(path.basename(file))
    }

    function renderDir(dirPath: string, depth: number): string {
      const indent = "  ".repeat(depth)
      let output = ""

      if (depth > 0) {
        output += `${indent}${path.basename(dirPath)}/\n`
      }

      const childIndent = "  ".repeat(depth + 1)
      const children = Array.from(dirs)
        .filter((d) => path.dirname(d) === dirPath && d !== dirPath)
        .sort()

      // Render subdirectories first
      for (const child of children) {
        output += renderDir(child, depth + 1)
      }

      // Render files
      const files = filesByDir.get(dirPath) || []
      for (const file of files.sort()) {
        output += `${childIndent}${file}\n`
      }

      return output
    }

    const output = `${searchPath}/\n` + renderDir(".", 0)

    const title = normalizeToWorkspacePath(searchPath, Instance.worktree)

    return {
      title,
      metadata: {
        count: entries.length,
        truncated,
      },
      output,
    }
  },
})
