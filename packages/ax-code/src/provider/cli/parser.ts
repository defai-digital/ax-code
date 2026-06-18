import { parseCliJsonObject, type CliJsonObject } from "./json"
import { isRecord } from "@/util/record"

export interface CliOutputParser {
  parseComplete(output: string): { text: string }
  parseStreamLine(line: string): string | null
}

export function parseCliJsonEventLine(line: string): CliJsonObject | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed[0] !== "{") return undefined
  return parseCliJsonObject(trimmed)
}

// Note: NO_COLOR=1 is set in CLI_ENV, so ANSI codes are not expected in output.
// parseCliJsonEventLine already handles non-JSON lines via fast-path check.

function recordField(record: CliJsonObject, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" ? value : undefined
}

function textFromContentBlocks(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
}

function rawTextLine(line: string): string | null {
  const text = line.replace(/\r$/, "")
  return text.trim().length > 0 ? text : null
}

export const claudeCodeParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      if (event.type === "result" && typeof event.result === "string") return { text: event.result }
      const message = recordField(event, "message")
      if (event.type === "assistant" && message?.content) {
        const text = textFromContentBlocks(message.content)
        if (text) parts.push(text)
      }
    }
    return { text: parts.join("\n") || output.trim() }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return null
    const deltaText = stringField(recordField(event, "delta"), "text")
    if (event.type === "content_block_delta" && deltaText) return deltaText
    if (event.type === "result" && typeof event.result === "string") return event.result
    return null
  },
}

export const geminiCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
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
    const event = parseCliJsonEventLine(line)
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
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      const item = recordField(event, "item")
      const itemText = stringField(item, "text")
      if (event.type === "item.completed" && itemText) {
        return { text: itemText }
      }
      const itemContent = item?.content
      if (event.type === "item.completed" && itemContent) {
        const text = Array.isArray(itemContent)
          ? textFromContentBlocks(itemContent)
          : typeof itemContent === "string"
            ? itemContent
            : null
        if (text) return { text }
      }
      if (typeof event.content === "string") parts.push(event.content)
      if (typeof event.text === "string") parts.push(event.text)
    }
    return { text: parts.join("\n") || output.trim() }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return null
    if (event.type === "item.completed") {
      const item = recordField(event, "item")
      const itemText = stringField(item, "text")
      if (itemText) return itemText
      if (typeof item?.content === "string") return item.content
    }
    if (typeof event.content === "string") return event.content
    if (typeof event.text === "string") return event.text
    return null
  },
}

export const qoderCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      if (event.type === "result") {
        if (typeof event.text === "string") return { text: event.text }
        if (typeof event.content === "string") return { text: event.content }
        if (typeof event.result === "string") return { text: event.result }
      }
      if (typeof event.content === "string") parts.push(event.content)
      if (typeof event.text === "string") parts.push(event.text)
    }
    return { text: parts.join("\n") || output.trim() }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return rawTextLine(line)
    if (event.type === "result") {
      if (typeof event.content === "string") return event.content
      if (typeof event.text === "string") return event.text
      if (typeof event.result === "string") return event.result
    }
    if (typeof event.content === "string") return event.content
    if (typeof event.text === "string") return event.text
    return null
  },
}

export const grokBuildCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      if (event.type === "result") {
        if (typeof event.text === "string") return { text: event.text }
        if (typeof event.content === "string") return { text: event.content }
        if (typeof event.result === "string") return { text: event.result }
      }
      if (typeof event.content === "string") parts.push(event.content)
      if (typeof event.text === "string") parts.push(event.text)
    }
    return { text: parts.join("\n") || output.trim() }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return rawTextLine(line)
    if (event.type === "result") {
      if (typeof event.content === "string") return event.content
      if (typeof event.text === "string") return event.text
      if (typeof event.result === "string") return event.result
    }
    if (typeof event.content === "string") return event.content
    if (typeof event.text === "string") return event.text
    return null
  },
}
