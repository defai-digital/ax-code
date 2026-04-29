export interface CliOutputParser {
  parseComplete(output: string): { text: string }
  parseStreamLine(line: string): string | null
}

function tryParse(line: string): Record<string, any> | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed[0] !== "{") return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

// Note: NO_COLOR=1 is set in CLI_ENV, so ANSI codes are not expected in output.
// tryParse already handles non-JSON lines via fast-path check.

export const claudeCodeParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    for (const line of lines) {
      const event = tryParse(line)
      if (!event) continue
      if (event.type === "result" && typeof event.result === "string") return { text: event.result }
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text") parts.push(block.text)
        }
      }
    }
    return { text: parts.join("\n") || output.trim() }
  },
  parseStreamLine(line: string) {
    const event = tryParse(line)
    if (!event) return null
    if (event.type === "content_block_delta" && event.delta?.text) return event.delta.text
    if (event.type === "result" && typeof event.result === "string") return event.result
    return null
  },
}

export const geminiCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    for (const line of lines) {
      const event = tryParse(line)
      if (!event) continue
      if (event.type === "result" && typeof event.text === "string") return { text: event.text }
      if (event.type === "result" && typeof event.content === "string") return { text: event.content }
      if (event.type === "message" && event.role !== "user") {
        const text =
          typeof event.content === "string" ? event.content : typeof event.text === "string" ? event.text : null
        if (text) parts.push(text)
      }
    }
    return { text: parts.join("\n") || output.trim() }
  },
  parseStreamLine(line: string) {
    const event = tryParse(line)
    if (!event) return null
    if (event.type === "result") {
      if (typeof event.content === "string") return event.content
      if (typeof event.text === "string") return event.text
    }
    if (event.type === "message" && event.role !== "user") {
      if (typeof event.content === "string") return event.content
      if (typeof event.text === "string") return event.text
    }
    return null
  },
}

export const codexCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    for (const line of lines) {
      const event = tryParse(line)
      if (!event) continue
      if (event.type === "item.completed" && event.item?.text) {
        return { text: event.item.text }
      }
      if (event.type === "item.completed" && event.item?.content) {
        const text = Array.isArray(event.item.content)
          ? event.item.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("")
          : typeof event.item.content === "string"
            ? event.item.content
            : null
        if (text) return { text }
      }
      if (typeof event.content === "string") parts.push(event.content)
      if (typeof event.text === "string") parts.push(event.text)
    }
    return { text: parts.join("\n") || output.trim() }
  },
  parseStreamLine(line: string) {
    const event = tryParse(line)
    if (!event) return null
    if (event.type === "item.completed") {
      if (event.item?.text) return event.item.text
      if (typeof event.item?.content === "string") return event.item.content
    }
    if (typeof event.content === "string") return event.content
    if (typeof event.text === "string") return event.text
    return null
  },
}
