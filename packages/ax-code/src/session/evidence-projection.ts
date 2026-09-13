import { createHash } from "node:crypto"
import type { ModelMessage } from "ai"

/** Operates on the final visible request, never on durable or conversion-cached parts. */
export function projectReadEvidence(messages: ModelMessage[]): {
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
      if (part.type !== "tool-result" || part.toolName !== "read" || part.output.type !== "text") return part
      const text = part.output.value
      if (
        !text.includes("<type>file</type>") ||
        text.includes("<system-reminder>") ||
        text.includes("total not counted") ||
        text.includes("Output capped") ||
        text.includes("line truncated to") ||
        Buffer.byteLength(text) < 1024
      )
        return part
      const identity = createHash("sha256").update(text).digest("hex")
      const prior = visible.get(identity)
      if (prior === undefined) {
        visible.set(identity, part.toolCallId)
        return part
      }
      const value = `Exact read output is already visible in tool result ${JSON.stringify(prior)}. Reuse that content; this read returned identical text.`
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
