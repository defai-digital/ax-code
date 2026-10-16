import path from "path"

/** ADR-225: upper bound for `--keep`, mirrored from SessionCompaction.COMPACTION_KEEP_MAX. */
export const COMPACT_KEEP_MAX = 50

export type CompactArgs = {
  /** Last N messages kept verbatim outside the summary (ADR-225). */
  keep?: number
  /** Read-only preview instead of starting a compaction (ADR-225). */
  preview: boolean
  /** Focus topic quoted into the compaction prompt (ADR-215). */
  focus?: string
}

/**
 * ADR-225: parse `/compact [--keep N] [--preview] [focus...]`.
 *
 * Flags may appear anywhere; the remaining free text is the focus, capped at
 * the ADR-215 limit (500 chars). A `--keep` value is clamped to 1..50 and a
 * non-numeric one is dropped rather than failing the command, so a focus that
 * happens to start with `--` is never mistaken for a flag. Pure so the TUI
 * command wiring stays testable without a renderer.
 */
export function parseCompactArgs(raw: string): CompactArgs {
  const result: CompactArgs = { preview: false }
  const focus: string[] = []
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === "--preview") {
      result.preview = true
      continue
    }
    if (token === "--keep") {
      const value = Number(tokens[i + 1])
      if (Number.isFinite(value)) {
        result.keep = Math.max(1, Math.min(COMPACT_KEEP_MAX, Math.floor(value)))
        i++
      }
      continue
    }
    if (token.startsWith("--keep=")) {
      const value = Number(token.slice("--keep=".length))
      if (Number.isFinite(value)) result.keep = Math.max(1, Math.min(COMPACT_KEEP_MAX, Math.floor(value)))
      continue
    }
    focus.push(token)
  }
  const text = focus.join(" ").trim().slice(0, 500)
  if (text) result.focus = text
  return result
}

/** ADR-225: render the read-only preview response for a dialog (pure, testable). */
export function renderCompactPreview(input: {
  summarizeMessages: number
  summarizeTokens: number
  keepMessages: number
  keepTokens: number
  prunedToolOutputs: Array<{ tool: string; parts: number; estimatedTokens: number }>
  focus: string
}): string {
  const lines = [
    `Messages to summarize: ${input.summarizeMessages} (~${input.summarizeTokens} tokens)`,
    `Messages kept verbatim: ${input.keepMessages} (~${input.keepTokens} tokens)`,
  ]
  if (input.prunedToolOutputs.length > 0) {
    const pruned = input.prunedToolOutputs
      .map((entry) => `${entry.tool} x${entry.parts} (~${entry.estimatedTokens} tokens)`)
      .join(", ")
    lines.push(`Tool outputs pruned from the summary: ${pruned}`)
  } else {
    lines.push("Tool outputs pruned from the summary: none")
  }
  lines.push(input.focus ? `Focus:\n${input.focus}` : "Focus: none")
  return lines.join("\n")
}

export const transcriptFilename = (id: string) => `session-${id.slice(0, 8)}.md`

export function resolveTranscriptExportPath(filename: string) {
  const trimmed = filename.trim()
  if (!trimmed) throw new Error("Export filename is required")
  if (path.isAbsolute(trimmed)) throw new Error("Export filename must be relative to the current workspace")

  const cwd = process.cwd()
  const resolved = path.resolve(cwd, trimmed)
  const relative = path.relative(cwd, resolved)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Export filename must stay inside the current workspace")
  }
  return resolved
}
