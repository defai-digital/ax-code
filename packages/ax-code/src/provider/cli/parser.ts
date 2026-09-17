import { parseCliJsonObject, type CliJsonObject } from "./json"
import { isRecord } from "@/util/record"

export interface CliOutputParser {
  parseComplete(output: string): { text: string }
  parseStreamLine(line: string): string | null
}

export class CliOutputError extends Error {
  readonly isRetryable = false

  constructor(message: string) {
    super(message)
    this.name = "CliOutputError"
  }
}

export function parseCliJsonEventLine(line: string): CliJsonObject | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed[0] !== "{") return undefined
  return parseCliJsonObject(trimmed)
}

/** True when stdout contains at least one structured CLI JSONL event object. */
export function stdoutHasCliJsonEvents(output: string): boolean {
  for (const line of output.split("\n")) {
    if (parseCliJsonEventLine(line)) return true
  }
  return false
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

function rawCompleteText(output: string): string {
  const text = output.replace(/\r?\n$/, "")
  return text.trim().length > 0 ? text : ""
}

function cliErrorText(value: string) {
  const parsed = parseCliJsonObject(value)
  if (!parsed) return value
  const nested = recordField(parsed, "error")
  return stringField(nested, "message") ?? stringField(parsed, "message") ?? value
}

function codexEventError(event: CliJsonObject) {
  const item = recordField(event, "item")
  const error = recordField(event, "error")
  const direct = stringField(event, "message")
  const nested = stringField(error, "message")
  const itemMessage = stringField(item, "message")
  if (event.type !== "error" && event.type !== "turn.failed" && item?.type !== "error") return undefined
  const message = direct ?? nested ?? itemMessage
  return message ? cliErrorText(message) : "Codex CLI reported an unknown error"
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
    return { text: parts.join("\n") || rawCompleteText(output) }
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

function qoderAuthError(event: CliJsonObject): string | undefined {
  const error = event.error
  if (error === "authentication_failed") return "Qoder CLI is not logged in. Run `qodercli login` first."
  if (typeof error === "string" && error.toLowerCase().includes("auth")) {
    return `Qoder CLI authentication failed: ${error}`
  }
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>
    const type = typeof record.type === "string" ? record.type.toLowerCase() : ""
    const code = typeof record.code === "string" ? record.code.toLowerCase() : ""
    const message = typeof record.message === "string" ? record.message : ""
    if (![type, code, message.toLowerCase()].some((value) => value.includes("auth") || value.includes("login"))) {
      return undefined
    }
    return message.trim()
      ? `Qoder CLI authentication failed: ${message}`
      : "Qoder CLI is not logged in. Run `qodercli login` first."
  }
  return undefined
}

// Qoder CLI 1.1.25 emits Claude-style stream-json (assistant content blocks and
// result events), plus system api_retry lines with authentication_failed.
export const qoderCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    const errors: string[] = []
    let sawJsonEvent = false
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      sawJsonEvent = true
      const error = qoderAuthError(event)
      if (error) {
        errors.push(error)
        continue
      }
      if (event.type === "result") {
        if (typeof event.result === "string") return { text: event.result }
        if (typeof event.text === "string") return { text: event.text }
        if (typeof event.content === "string") return { text: event.content }
      }
      const message = recordField(event, "message")
      if (event.type === "assistant" && message?.content) {
        const text = textFromContentBlocks(message.content)
        if (text) parts.push(text)
      }
    }
    if (errors.length && parts.length === 0) throw new CliOutputError(errors.at(-1)!)
    if (parts.length) return { text: parts.join("\n") }
    if (sawJsonEvent) return { text: "" }
    return { text: rawCompleteText(output) }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return null
    const deltaText = stringField(recordField(event, "delta"), "text")
    if (event.type === "content_block_delta" && deltaText) return deltaText
    if (event.type === "result") {
      if (typeof event.result === "string") return event.result
      if (typeof event.text === "string") return event.text
      if (typeof event.content === "string") return event.content
    }
    return null
  },
}

export const codexCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    const errors: string[] = []
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      const error = codexEventError(event)
      if (error) {
        errors.push(error)
        continue
      }
      const item = recordField(event, "item")
      const itemText = stringField(item, "text")
      if (event.type === "item.completed" && itemText) {
        parts.push(itemText)
        continue
      }
      const itemContent = item?.content
      if (event.type === "item.completed" && itemContent) {
        const text = Array.isArray(itemContent)
          ? textFromContentBlocks(itemContent)
          : typeof itemContent === "string"
            ? itemContent
            : null
        if (text) parts.push(text)
      }
      if (typeof event.content === "string") parts.push(event.content)
      if (typeof event.text === "string") parts.push(event.text)
    }
    if (errors.length) throw new CliOutputError(errors.at(-1)!)
    return { text: parts.join("\n") || rawCompleteText(output) }
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
    return { text: parts.join("\n") || rawCompleteText(output) }
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

function kimiMessageContentText(content: unknown): string | undefined {
  if (typeof content === "string") {
    const text = content.trim().length > 0 ? content : undefined
    return text
  }
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => (block as { text: string }).text)
    .join("")
  return text.trim().length > 0 ? text : undefined
}

function kimiAssistantText(event: CliJsonObject): string | undefined {
  if (event.role !== "assistant") return undefined
  return kimiMessageContentText(event.content) ?? (typeof event.text === "string" ? event.text : undefined)
}

// Kimi Code CLI stream-json emits Message-format JSONL:
//   {"role":"assistant","content":"..."}
//   {"role":"tool",...}
//   {"role":"meta","type":"session.resume_hint",...}
// Prefer the last non-empty assistant message and ignore tool/meta noise.
// When JSONL events were present but no assistant text arrived, return empty
// instead of falling back to raw JSON (which would leak meta/tool payloads).
export const kimiCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    let last: string | undefined
    let sawJsonEvent = false
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      sawJsonEvent = true
      const text = kimiAssistantText(event)
      if (text) last = text
    }
    if (last !== undefined) return { text: last }
    if (sawJsonEvent) return { text: "" }
    return { text: rawCompleteText(output) }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return rawTextLine(line)
    return kimiAssistantText(event) ?? null
  },
}

function musePayloadText(event: CliJsonObject): string | undefined {
  return stringField(recordField(event, "payload"), "text")
}

function museTerminalError(event: CliJsonObject): string | undefined {
  const payload = recordField(event, "payload")
  if (event.payload_type === "run.terminal.failed") {
    return stringField(payload, "reason") ?? stringField(payload, "text") ?? "Muse CLI run failed"
  }
  if (event.payload_type !== "run.terminal.completed") return undefined
  const terminal = stringField(payload, "terminal")
  if (!terminal || terminal === "completed") return undefined
  return stringField(payload, "reason") ?? stringField(payload, "text") ?? `Muse CLI run ${terminal}`
}

// Muse exec --json emits durable MSP JSONL. Assistant text streams as
// run.output.delta payloads; run.terminal.completed repeats the consolidated
// answer. Concatenate deltas only so complete parsing does not double-count.
export const museCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const deltas: string[] = []
    let terminal: string | undefined
    let sawJsonEvent = false
    const errors: string[] = []
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      sawJsonEvent = true
      const error = museTerminalError(event)
      if (error) {
        errors.push(error)
        continue
      }
      const text = musePayloadText(event)
      if (event.payload_type === "run.output.delta" && text) deltas.push(text)
      else if (event.payload_type === "run.terminal.completed" && text) terminal = text
    }
    if (errors.length) throw new CliOutputError(errors.at(-1)!)
    if (deltas.length) return { text: deltas.join("") }
    if (terminal !== undefined) return { text: terminal }
    if (sawJsonEvent) return { text: "" }
    return { text: rawCompleteText(output) }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return null
    if (event.payload_type !== "run.output.delta") return null
    return musePayloadText(event) ?? null
  },
}

function minimaxItem(event: CliJsonObject) {
  return recordField(event, "item")
}

function minimaxItemType(item: Record<string, unknown> | undefined): string | undefined {
  return stringField(item, "type") ?? stringField(item, "item_type")
}

function isMiniMaxAssistantItem(item: Record<string, unknown> | undefined): boolean {
  const type = minimaxItemType(item)
  return type === "assistant_message" || type === "agent_message"
}

function minimaxAssistantText(event: CliJsonObject): string | undefined {
  if (event.type === "exec.result" || event.type === "exec.completed") {
    return typeof event.output === "string" ? event.output : undefined
  }
  const item = minimaxItem(event)
  if (!isMiniMaxAssistantItem(item)) return undefined
  return stringField(item, "text")
}

function minimaxResultStatus(event: CliJsonObject): string | undefined {
  if (event.type === "exec.result" || event.type === "exec.completed") {
    return stringField(event, "status")
  }
  return undefined
}

function minimaxTerminalError(event: CliJsonObject): string | undefined {
  if (event.type === "turn.failed") {
    const error = recordField(event, "error")
    return stringField(error, "message") ?? stringField(event, "message") ?? "MiniMax Code CLI turn failed"
  }
  const status = minimaxResultStatus(event)
  if (!status || status === "succeeded") return undefined
  const error = recordField(event, "error")
  return stringField(error, "message") ?? stringField(event, "output") ?? `MiniMax Code CLI run ${status}`
}

// MiniMax Code CLI exec --output-format stream-json emits versioned JSONL.
// Assistant text lives on assistant_message / agent_message items; the
// exec.result / exec.completed output is the consolidated fallback.
export const minimaxCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const trimmed = output.trim()
    const direct = parseCliJsonObject(trimmed)
    if (direct && !trimmed.includes("\n")) {
      const error = minimaxTerminalError(direct)
      if (error) throw new CliOutputError(error)
      const text = minimaxAssistantText(direct)
      if (text !== undefined) return { text }
      if (direct.type) return { text: "" }
    }

    const lines = output.split("\n")
    let last: string | undefined
    let fallback: string | undefined
    let sawJsonEvent = false
    const errors: string[] = []
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      sawJsonEvent = true
      const error = minimaxTerminalError(event)
      if (error) {
        errors.push(error)
        continue
      }
      const item = minimaxItem(event)
      if (isMiniMaxAssistantItem(item) && (event.type === "item.completed" || !event.type)) {
        const text = stringField(item, "text")
        if (text) last = text
        continue
      }
      if (event.type === "exec.result" || event.type === "exec.completed") {
        const text = typeof event.output === "string" ? event.output : undefined
        if (text) fallback = text
      }
    }
    if (errors.length) throw new CliOutputError(errors.at(-1)!)
    if (last !== undefined) return { text: last }
    if (fallback !== undefined) return { text: fallback }
    if (sawJsonEvent) return { text: "" }
    return { text: rawCompleteText(output) }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return null
    const item = minimaxItem(event)
    if (!isMiniMaxAssistantItem(item)) return null
    // Stream only incremental deltas. item.completed repeats the consolidated
    // text and is the complete-parse fallback, matching muse's delta/terminal split.
    if (event.type !== "item.updated") return null
    return stringField(item, "delta") ?? stringField(event, "delta") ?? null
  },
}
