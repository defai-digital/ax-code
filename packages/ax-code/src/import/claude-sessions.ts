import fs from "fs/promises"
import path from "path"
import { Env } from "../util/env"
import { Global } from "../global"
import { isRecord } from "@/util/record"
import { parseJsonResult } from "@/util/json-value"

/**
 * Import Claude Code session history (ADR-229).
 *
 * Claude Code stores one JSONL transcript per conversation under
 * `~/.claude/projects/<project path with "/" replaced by "-">/*.jsonl`.
 * This module reads those transcripts and builds a single summary text per
 * transcript so the context is available in one AX Code session without
 * replaying any tool. It never executes anything from the transcript.
 *
 * The parsing/summary functions are pure; the filesystem reads and the
 * session-creation step are separated so the dry-run listing and the summary
 * builder can be tested without a database.
 */
export namespace ClaudeSessions {
  /** Maximum summary size in characters (ADR-229: truncated to 20 KB). */
  export const SUMMARY_MAX_CHARS = 20 * 1024

  export interface Transcript {
    /** Absolute path of the source `.jsonl` file. */
    sourcePath: string
    /** Base name without extension, used as the suggested session title. */
    name: string
    /** Summary text built from the transcript. */
    summary: string
  }

  export interface Report {
    /** Project source directory that was scanned. */
    directory: string
    /** Project transcript directory that would be read. */
    projectDirectory: string
    /** Whether any missing source directory made the scan empty. */
    missing: boolean
    dryRun: boolean
    transcripts: Transcript[]
  }

  /**
   * Claude Code's directory-name encoding: every character of the absolute
   * project path that is not an ASCII letter or digit becomes `-` (separators,
   * dots, underscores, spaces alike).
   * `/Users/me/project` -> `-Users-me-project`, `/Users/me/.config/my_app` ->
   * `-Users-me--config-my-app`.
   */
  export function encodeProjectPath(projectPath: string): string {
    return projectPath.replace(/[^A-Za-z0-9]/g, "-")
  }

  /** Directory Claude Code would keep the transcripts for `projectPath`. */
  export function projectDirectory(input: { root: string; projectPath: string }): string {
    return path.join(input.root, encodeProjectPath(input.projectPath))
  }

  interface TextChunk {
    role: "user" | "assistant"
    text: string
  }

  /**
   * Extract the readable text from one parsed transcript record. Handles the
   * two shapes Claude Code emits: `message.content` as a string, or as an
   * array of typed blocks (text blocks keep their text; tool_use blocks are
   * described by name only; tool_result content is summarized).
   */
  function readRecord(record: unknown): TextChunk[] {
    if (!isRecord(record)) return []
    const role = record.type === "user" ? "user" : record.type === "assistant" ? "assistant" : undefined
    if (!role) return []
    const message = isRecord(record.message) ? record.message : undefined
    if (!message) return []

    const blocks = message.content
    if (typeof blocks === "string") {
      return blocks.trim() ? [{ role, text: blocks }] : []
    }
    if (!Array.isArray(blocks)) return []

    const chunks: TextChunk[] = []
    for (const block of blocks) {
      if (!isRecord(block)) continue
      const type = block.type
      if (type === "text" && typeof block.text === "string" && block.text.trim()) {
        chunks.push({ role, text: block.text })
        continue
      }
      // Tool calls are described, never replayed: only the tool name is kept.
      if (type === "tool_use" && typeof block.name === "string") {
        chunks.push({ role, text: `[tool] ${block.name}` })
        continue
      }
      // Tool results are content the assistant already consumed; summarize
      // them so the reader knows something came back without pulling in a
      // potentially large payload.
      if (type === "tool_result") {
        chunks.push({ role, text: "[tool result]" })
      }
    }
    return chunks
  }

  /** Redact secret shapes, then truncate to the ADR-229 budget. */
  export function finalizeSummary(text: string): string {
    const redacted = Env.redactForRecord(text)
    if (redacted.length <= SUMMARY_MAX_CHARS) return redacted
    const dropped = redacted.length - SUMMARY_MAX_CHARS
    return `${redacted.slice(0, SUMMARY_MAX_CHARS)}\n[+${dropped} chars truncated]`
  }

  /**
   * Build the summary text for one transcript file. Content is data: tool
   * calls are named, secrets are redacted, and the result is truncated.
   */
  export function buildSummary(text: string): string {
    const lines: string[] = []
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      const parsed = parseJsonResult(line)
      if (!parsed.ok) continue
      for (const chunk of readRecord(parsed.value)) {
        const label = chunk.role === "user" ? "User" : "Assistant"
        lines.push(`${label}: ${chunk.text}`)
      }
    }
    return finalizeSummary(lines.join("\n\n"))
  }

  async function listTranscripts(directory: string): Promise<string[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(directory)
    } catch {
      return []
    }
    return entries
      .filter((entry) => entry.endsWith(".jsonl"))
      .map((entry) => path.join(directory, entry))
      .sort()
  }

  /**
   * Scan one project directory and build a Transcript per JSONL file.
   * Read/summary only; no session is created here.
   */
  export async function collect(input: {
    projectDirectory: string
  }): Promise<{ missing: boolean; transcripts: Transcript[] }> {
    const files = await listTranscripts(input.projectDirectory)
    if (files.length === 0) {
      let missing = false
      try {
        await fs.access(input.projectDirectory)
      } catch {
        missing = true
      }
      return { missing, transcripts: [] }
    }
    const transcripts: Transcript[] = []
    for (const sourcePath of files) {
      let raw: string
      try {
        raw = await fs.readFile(sourcePath, "utf8")
      } catch {
        continue
      }
      transcripts.push({
        sourcePath,
        name: path.basename(sourcePath, ".jsonl"),
        summary: buildSummary(raw),
      })
    }
    return { missing: false, transcripts }
  }

  /**
   * Dry-run listing by default; with `write` and an injected `createSession`,
   * each transcript becomes one AX Code session whose single user message is
   * the built summary.
   */
  export async function run(input: {
    projectPath: string
    projectDirectory: string
    write: boolean
    createSession?: (transcript: Transcript) => Promise<void>
  }): Promise<Report> {
    const collected = await collect({ projectDirectory: input.projectDirectory })
    const report: Report = {
      directory: input.projectPath,
      projectDirectory: input.projectDirectory,
      missing: collected.missing,
      dryRun: !input.write,
      transcripts: collected.transcripts,
    }
    if (!input.write) return report
    if (!input.createSession)
      throw new Error("ClaudeSessions.run: write requested without a createSession implementation")
    for (const transcript of collected.transcripts) {
      await input.createSession(transcript)
    }
    return { ...report, dryRun: false }
  }

  /** Default root: `~/.claude/projects`. */
  export function defaultRoot(): string {
    return path.join(Global.Path.home, ".claude", "projects")
  }
}
