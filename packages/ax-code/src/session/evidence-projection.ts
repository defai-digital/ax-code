import { createHash } from "node:crypto"
import type { ModelMessage } from "ai"

/**
 * Read-only tools whose identical visible output may be replaced by a pointer to
 * an earlier copy in the same request. Execution is never skipped: this operates
 * only on the final projected request after normal message conversion.
 */
const DEDUPE_TOOLS = new Set(["read", "grep", "glob"])

// Keep one full returned view, even when the underlying source has more data.
// Only recognized built-in pagination footers may be referenced (ADR-122).
const READ_HOLDS = ["total not counted", "Output capped", "line truncated to"]
const GREP_HOLDS = ["(Results truncated:"]
const GLOB_HOLDS = ["(Results are truncated"]

/** True when an output must stay verbatim: instruction-bearing or partial/hidden. */
function holds(toolName: string, text: string, footer?: string): boolean {
  if (text.includes("<system-reminder>")) return true
  if (text.includes("line truncated to")) return true
  if (toolName === "read") {
    if (!text.includes("<type>file</type>")) return true
    return !footer && READ_HOLDS.some((marker) => text.includes(marker))
  }
  if (toolName === "grep")
    return (
      text.includes("results or context truncated") || (!footer && GREP_HOLDS.some((marker) => text.includes(marker)))
    )
  if (toolName === "glob") return !footer && GLOB_HOLDS.some((marker) => text.includes(marker))
  return true
}

function partialFooter(toolName: string, text: string): string | undefined {
  if (toolName === "read")
    return /\n\n(\((?:Showing lines \d+-\d+\. More lines remain; total not counted\. Use offset=\d+ to continue\.|Output capped at \d+ KB\. Showing lines \d+-\d+ of file\. Use offset=\d+ to continue\.)\))\n<\/content>$/.exec(
      text,
    )?.[1]
  if (toolName === "grep")
    return /\n(\(Results truncated: showing \d+ of \d+ matches \(\d+ hidden\)\. Consider using a more specific path or pattern\.\))\n?$/.exec(
      text,
    )?.[1]
  if (toolName === "glob")
    return /\n(\(Results are truncated: showing first \d+ results(?:\.\.\.|\. Consider using a more specific path or pattern\.)\))\n?$/.exec(
      text,
    )?.[1]
  return undefined
}

/**
 * Operates on the final visible request, never on durable or conversion-cached
 * parts. Content-addressed by tool name plus exact output bytes, so a changed
 * result never collides. Only the replacement is dropped; every tool-call/result
 * pair and the first full copy are retained.
 */
export function projectToolEvidence(messages: ModelMessage[]): {
  messages: ModelMessage[]
  omittedBytes: number
  duplicates: number
} {
  const visible = new Map<string, string>()
  let omittedBytes = 0
  let duplicates = 0
  const projected = messages.map((message): ModelMessage => {
    if (message.role !== "tool") return message
    let changed = false
    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || part.output.type !== "text") return part
      if (!DEDUPE_TOOLS.has(part.toolName)) return part
      const text = part.output.value
      const footer = partialFooter(part.toolName, text)
      if (holds(part.toolName, text, footer)) return part
      const identity = createHash("sha256").update(`${part.toolName}\u0000${text}`).digest("hex")
      const prior = visible.get(identity)
      if (prior === undefined) {
        visible.set(identity, part.toolCallId)
        return part
      }
      const reference = `Exact ${part.toolName} output is already visible in tool result ${JSON.stringify(prior)}. Reuse that content; this call returned identical text.`
      const value = footer
        ? `${reference}\nThis is the same partial view; omitted source content is still unavailable.\n${footer}`
        : reference
      // Never regress request size: a pointer longer than the text it replaces
      // leaves the original output in place.
      if (Buffer.byteLength(value) >= Buffer.byteLength(text)) return part
      changed = true
      duplicates++
      omittedBytes += Buffer.byteLength(text) - Buffer.byteLength(value)
      return { ...part, output: { ...part.output, value } }
    })
    return changed ? { ...message, content } : message
  })
  return { messages: duplicates ? projected : messages, omittedBytes, duplicates }
}
