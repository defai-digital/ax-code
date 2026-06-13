import fs from "node:fs/promises"
import path from "path"
import type { Agent } from "../agent/agent"
import { evaluate } from "@/permission/evaluate"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"
import { MAX_LINES as _MAX_LINES, MAX_BYTES as _MAX_BYTES } from "@/constants/tool"

export namespace Truncate {
  const log = Log.create({ service: "truncation" })
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
  const MAX_DIR_BYTES = 200 * 1024 * 1024 // 200 MB disk cap

  export const MAX_LINES = _MAX_LINES
  export const MAX_BYTES = _MAX_BYTES
  export const DIR = TRUNCATION_DIR
  export const GLOB = path.join(TRUNCATION_DIR, "*")

  let cleanupStarted = false

  /** Short description of what kind of content was truncated, derived from
   *  the first few lines of the original output. Helps the LLM decide whether
   *  to re-read the full file or proceed with the truncated preview. */
  function contentHint(text: string): string {
    const first3Lines = text.split("\n").slice(0, 3).join("\n").slice(0, 200)
    if (!first3Lines) return "empty output"
    // Try to classify the content type heuristically
    const trimmed = first3Lines.trimStart()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "JSON output"
    if (trimmed.startsWith("PASS") || trimmed.startsWith("FAIL") || trimmed.includes("test")) return "test output"
    if (trimmed.startsWith("error") || trimmed.startsWith("Error") || trimmed.includes("error:")) return "error output"
    if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return "HTML output"
    if (
      trimmed.startsWith("```") ||
      trimmed.includes("function ") ||
      trimmed.includes("const ") ||
      trimmed.includes("import ")
    )
      return "code output"
    return first3Lines.length >= 200 ? `${first3Lines.slice(0, 180)}…` : first3Lines
  }

  export type Result =
    | { content: string; truncated: false }
    | {
        content: string
        truncated: true
        outputPath: string
        fullOutputPath: string
        originalSize: number
        truncatedTo: number
        contentHint: string
      }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
  }

  function hasTaskTool(agent?: Agent.Info) {
    if (!agent?.permission) return false
    return evaluate("task", "*", agent.permission).action !== "deny"
  }

  async function readEntries() {
    return fs
      .readdir(TRUNCATION_DIR)
      .then((all) => all.filter((name) => name.startsWith("tool_")).sort())
      .catch(() => [] as string[])
  }

  async function removeQuietly(filepath: string) {
    await fs.rm(filepath, { force: true }).catch(() => undefined)
  }

  export async function cleanup() {
    const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - RETENTION_MS))
    const entries = await readEntries()

    // Time-based cleanup
    for (const entry of entries) {
      if (Identifier.timestamp(entry) >= cutoff) continue
      await removeQuietly(path.join(TRUNCATION_DIR, entry))
    }

    // Size-based cleanup: remove oldest files until under disk cap.
    const remaining = await readEntries()
    let totalSize = 0
    const sizes: { name: string; size: number }[] = []
    for (const entry of remaining) {
      const stat = await fs.stat(path.join(TRUNCATION_DIR, entry)).catch(() => ({ size: 0 }))
      const size = Number(stat.size)
      sizes.push({ name: entry, size })
      totalSize += size
    }
    if (totalSize <= MAX_DIR_BYTES) return

    for (const item of sizes) {
      if (totalSize <= MAX_DIR_BYTES) break
      await removeQuietly(path.join(TRUNCATION_DIR, item.name))
      totalSize -= item.size
    }
  }

  function startCleanup() {
    if (cleanupStarted) return
    cleanupStarted = true
    cleanup().catch((error) => log.error("truncation cleanup failed", { error }))
    const timer = setInterval(() => {
      cleanup().catch((error) => log.error("truncation cleanup failed", { error }))
    }, CLEANUP_INTERVAL_MS)
    timer.unref()
  }

  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    startCleanup()

    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? MAX_BYTES
    const direction = options.direction ?? "head"
    const lines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf-8")

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false } as const
    }

    const out: string[] = []
    let i = 0
    let bytes = 0
    let hitBytes = false

    if (direction === "head") {
      for (i = 0; i < lines.length && i < maxLines; i++) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.push(lines[i])
        bytes += size
      }
    } else {
      for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.unshift(lines[i])
        bytes += size
      }
    }

    const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
    const unit = hitBytes ? "bytes" : "lines"
    const preview = out.join("\n")
    const file = path.join(TRUNCATION_DIR, ToolID.ascending())

    await fs.mkdir(TRUNCATION_DIR, { recursive: true })
    await fs.writeFile(file, text)

    const hint = hasTaskTool(agent)
      ? `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
      : `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

    return {
      content:
        direction === "head"
          ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
          : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`,
      truncated: true,
      outputPath: file,
      fullOutputPath: file,
      originalSize: totalBytes,
      truncatedTo: bytes,
      contentHint: contentHint(text),
    } as const
  }
}
