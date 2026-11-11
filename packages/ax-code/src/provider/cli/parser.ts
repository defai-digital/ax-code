import { parseCliJsonObject, type CliJsonObject } from "./json"
import { isRecord } from "@/util/record"

/** Real token usage reported by a CLI, already normalized to total counts. */
export interface CliUsage {
  /** Total input (prompt) tokens, including any cached tokens. */
  inputTokens: number
  /** Total output (completion) tokens. */
  outputTokens: number
  /** Cached input tokens read (a subset of the input total). */
  cacheReadTokens?: number
  /** Cached input tokens written (a subset of the input total). */
  cacheWriteTokens?: number
  /** Reasoning tokens (a subset of the output total). */
  reasoningTokens?: number
}

/**
 * Per-stream scratch space for parsers that need to distinguish separate
 * messages on a single stream (for example Kimi's one-message-per-line JSONL).
 */
export type CliStreamState = Record<string, unknown>

export interface CliOutputParser {
  parseComplete(output: string): { text: string }
  parseStreamLine(line: string, state?: CliStreamState): string | null
  /**
   * Extract the real usage the CLI reported for this run. Returns undefined
   * when the CLI exposes no usage, so the model falls back to an estimate.
   */
  parseUsage?(output: string): CliUsage | undefined
  /**
   * Detect a CLI that silently ran a different model than the one requested.
   * Returns an actionable message when the effective model differs, otherwise
   * undefined (including when the CLI reports no model at all).
   */
  parseModelMismatch?(output: string, requestedModel: string): string | undefined
  /**
   * True when the line is a run-level terminal event. Streaming callers that
   * opt in can finish as soon as it arrives instead of waiting for the CLI
   * process to exit. Only providers whose captures show a reliable terminal
   * event implement this.
   */
  isTerminalEvent?(line: string): boolean
  /**
   * True when `parseStreamLine` returned the line verbatim as plain text
   * instead of text extracted from a structured event. Streaming callers use
   * this to restore the newline the line split consumed: a plain reply line
   * that happens to parse as JSON must not be treated as a JSONL event.
   */
  streamLineIsRaw?(line: string, state?: CliStreamState): boolean
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

function recordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key]
  return isRecord(value) ? value : undefined
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" ? value : undefined
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
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
  // Codex's exec protocol reserves `error` and `turn.failed` for terminal
  // stream failures. Completed items with `item.type === "error"` describe
  // non-fatal conditions (config warnings, deprecation notices, model
  // reroutes), so treating them as fatal aborts turns that finish normally.
  if (event.type !== "error" && event.type !== "turn.failed") return undefined
  const error = recordField(event, "error")
  const message = stringField(event, "message") ?? stringField(error, "message")
  return message ? cliErrorText(message) : "Codex CLI reported an unknown error"
}

function codexItemText(event: CliJsonObject): string | undefined {
  const item = recordField(event, "item")
  if (!item || (item.type !== undefined && item.type !== "agent_message")) return undefined
  const text = stringField(item, "text")
  if (text) return text
  if (typeof item.content === "string") return item.content
  return textFromContentBlocks(item.content) || undefined
}

// Claude's result usage reports non-cached input in `input_tokens` and cache
// tokens separately, so the total is their sum. Thinking tokens are a subset of
// `output_tokens`.
function claudeUsage(output: string): CliUsage | undefined {
  let usage: CliUsage | undefined
  for (const line of output.split("\n")) {
    const event = parseCliJsonEventLine(line)
    if (!event || event.type !== "result") continue
    const value = recordField(event, "usage")
    if (!value) continue
    const input = numberField(value, "input_tokens")
    const outputTokens = numberField(value, "output_tokens")
    if (input === undefined && outputTokens === undefined) continue
    const cacheRead = numberField(value, "cache_read_input_tokens") ?? 0
    const cacheWrite = numberField(value, "cache_creation_input_tokens") ?? 0
    usage = {
      inputTokens: (input ?? 0) + cacheRead + cacheWrite,
      outputTokens: outputTokens ?? 0,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      reasoningTokens: numberField(recordField(value, "output_tokens_details"), "thinking_tokens") ?? 0,
    }
  }
  return usage
}

function claudeResultError(event: CliJsonObject): string | undefined {
  if (event.type !== "result") return undefined
  const subtype = stringField(event, "subtype")
  const isError = event.is_error === true || (subtype !== undefined && subtype.startsWith("error"))
  if (!isError) return undefined
  const result = stringField(event, "result")
  if (result?.trim()) return result
  const error =
    stringField(event, "error") ?? stringField(recordField(event, "error"), "message") ?? stringField(event, "message")
  return error?.trim() ? error : "Claude Code CLI reported an error"
}

export const claudeCodeParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    let sawJsonEvent = false
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      sawJsonEvent = true
      const error = claudeResultError(event)
      if (error) throw new CliOutputError(error)
      if (event.type === "result" && typeof event.result === "string") return { text: event.result }
      const message = recordField(event, "message")
      if (event.type === "assistant" && message?.content) {
        const text = textFromContentBlocks(message.content)
        if (text) parts.push(text)
      }
    }
    // A structured transcript without assistant text (for example a system
    // init event) must stay empty so callers report "no assistant output"
    // instead of showing the JSONL transport as the model reply.
    if (parts.length) return { text: parts.join("\n") }
    if (sawJsonEvent) return { text: "" }
    return { text: rawCompleteText(output) }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return null
    if (claudeResultError(event)) return null
    const deltaText = stringField(recordField(event, "delta"), "text")
    if (event.type === "content_block_delta" && deltaText) return deltaText
    // `--include-partial-messages` wraps Anthropic stream events in a
    // `stream_event` envelope. Only the top-level conversation streams here;
    // sub-agent output (parent_tool_use_id set) is not part of the answer, and
    // the whole assistant message plus the final `result` repeat the same text,
    // so returning those would duplicate the streamed output.
    if (event.type === "stream_event") {
      const parent = event.parent_tool_use_id
      if (parent !== undefined && parent !== null) return null
      const inner = recordField(event, "event")
      if (stringField(inner, "type") !== "content_block_delta") return null
      const delta = recordField(inner, "delta")
      if (stringField(delta, "type") !== "text_delta") return null
      return stringField(delta, "text") || null
    }
    return null
  },
  parseUsage: claudeUsage,
}

// Codex `turn.completed.usage` follows OpenAI semantics: `input_tokens`
// already includes cached input, and `reasoning_output_tokens` is a subset of
// `output_tokens`.
function codexUsage(output: string): CliUsage | undefined {
  let usage: CliUsage | undefined
  for (const line of output.split("\n")) {
    const event = parseCliJsonEventLine(line)
    if (!event || event.type !== "turn.completed") continue
    const value = recordField(event, "usage")
    if (!value) continue
    const input = numberField(value, "input_tokens")
    const outputTokens = numberField(value, "output_tokens")
    if (input === undefined && outputTokens === undefined) continue
    usage = {
      inputTokens: input ?? 0,
      outputTokens: outputTokens ?? 0,
      cacheReadTokens: numberField(value, "cached_input_tokens") ?? 0,
      cacheWriteTokens: numberField(value, "cache_write_input_tokens") ?? 0,
      reasoningTokens: numberField(value, "reasoning_output_tokens") ?? 0,
    }
  }
  return usage
}

export const codexCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const lines = output.split("\n")
    const parts: string[] = []
    const errors: string[] = []
    let structured = false
    let completed = false
    let failed = false
    for (const line of lines) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      structured = true
      // Codex also emits a stream-level `error` for failures it retries; only
      // a `turn.failed` or a transcript that never reaches `turn.completed`
      // makes those errors terminal.
      if (event.type === "turn.completed") completed = true
      if (event.type === "turn.failed") failed = true
      const error = codexEventError(event)
      if (error) {
        errors.push(error)
        continue
      }
      if (event.type === "item.completed") {
        const text = codexItemText(event)
        if (text) parts.push(text)
        continue
      }
      if (typeof event.content === "string") parts.push(event.content)
      if (typeof event.text === "string") parts.push(event.text)
    }
    if (errors.length && (failed || !completed)) throw new CliOutputError(errors.at(-1)!)
    // Fall back to raw stdout only for plain-text CLIs. A structured transcript
    // without assistant text (for example warnings plus turn.completed) must
    // stay empty so callers report "no assistant output" instead of showing
    // the JSONL transport as the model reply.
    return { text: parts.join("\n") || (structured ? "" : rawCompleteText(output)) }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return null
    if (event.type === "item.completed") {
      return codexItemText(event) ?? null
    }
    if (typeof event.content === "string") return event.content
    if (typeof event.text === "string") return event.text
    return null
  },
  parseUsage: codexUsage,
}

// Grok `--output-format streaming-json` emits:
//   {"type":"available_commands",...}  ignored control event
//   {"type":"text","data":"..."}       assistant text delta (concatenate exactly)
//   {"type":"usage","usage":{...}}
//   {"type":"end","stopReason":"end_turn",...}
//   {"type":"error","message":"..."}   fatal, exits non-zero
// Older `--output-format json` prints one object with `text`; plain stdout (no
// JSON events) still falls back to raw text.
function grokEventError(event: CliJsonObject): string | undefined {
  if (event.type !== "error") return undefined
  const message = stringField(event, "message") ?? stringField(recordField(event, "error"), "message")
  return message ? cliErrorText(message) : "Grok CLI reported an unknown error"
}

function grokTextDelta(event: CliJsonObject): string | undefined {
  if (event.type !== "text") return undefined
  return typeof event.data === "string" ? event.data : undefined
}

// Single-object `json` output and legacy event shapes.
function grokConsolidatedText(event: CliJsonObject): string | undefined {
  return stringField(event, "text") ?? stringField(event, "content") ?? stringField(event, "result")
}

function grokUsageFrom(value: Record<string, unknown> | undefined): CliUsage | undefined {
  if (!value) return undefined
  const input = numberField(value, "input_tokens")
  const output = numberField(value, "output_tokens")
  if (input === undefined && output === undefined) return undefined
  const cacheRead = numberField(value, "cache_read_input_tokens") ?? 0
  const cacheWrite = numberField(value, "cache_creation_input_tokens") ?? 0
  return {
    inputTokens: (input ?? 0) + cacheRead + cacheWrite,
    outputTokens: output ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: numberField(value, "reasoning_tokens") ?? 0,
  }
}

function grokUsage(output: string): CliUsage | undefined {
  const single = parseCliJsonObject(output.trim())
  const fromSingle = single ? grokUsageFrom(recordField(single, "usage")) : undefined
  if (fromSingle) return fromSingle
  let usage: CliUsage | undefined
  for (const line of output.split("\n")) {
    const event = parseCliJsonEventLine(line)
    if (!event || (event.type !== "usage" && event.type !== "end")) continue
    usage = grokUsageFrom(recordField(event, "usage")) ?? usage
  }
  return usage
}

export const grokBuildCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const single = parseCliJsonObject(output.trim())
    if (single) {
      const error = grokEventError(single)
      if (error) throw new CliOutputError(error)
      const text = grokConsolidatedText(single)
      if (text !== undefined) return { text }
      if (single.type !== undefined) return { text: "" }
    }
    const deltas: string[] = []
    let sawTypedEvent = false
    let sawTextEvent = false
    for (const line of output.split("\n")) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      // Grok events always carry a `type`. A bare JSON object with no type is a
      // plain-text reply line that happens to be JSON (older grok without
      // `--output-format`), so leave it to the raw fallback instead of dropping
      // it as an unknown control event.
      if (stringField(event, "type") === undefined) continue
      sawTypedEvent = true
      const error = grokEventError(event)
      if (error) throw new CliOutputError(error)
      const delta = grokTextDelta(event)
      if (delta !== undefined) {
        deltas.push(delta)
        sawTextEvent = true
      }
    }
    if (sawTextEvent) return { text: deltas.join("") }
    if (sawTypedEvent) return { text: "" }
    return { text: rawCompleteText(output) }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return rawTextLine(line)
    if (stringField(event, "type") === undefined) return rawTextLine(line)
    const error = grokEventError(event)
    if (error) throw new CliOutputError(error)
    return grokTextDelta(event) ?? null
  },
  // Grok events always carry `type`; an untyped JSON object is a plain-text
  // reply line, so the stream must keep its newline.
  streamLineIsRaw(line: string) {
    const event = parseCliJsonEventLine(line)
    return !event || stringField(event, "type") === undefined
  },
  parseUsage: grokUsage,
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
  parseStreamLine(line: string, state?: CliStreamState) {
    const event = parseCliJsonEventLine(line)
    if (!event) return rawTextLine(line)
    const text = kimiAssistantText(event)
    if (text === undefined) return null
    // Each assistant JSONL line is a whole message, not a token delta. Separate
    // distinct messages the way a reader expects instead of gluing them
    // together; parseComplete keeps only the final message, so the stream must
    // carry the delimiters itself.
    const seen = typeof state?.assistantMessages === "number" ? state.assistantMessages : 0
    if (state) state.assistantMessages = seen + 1
    return seen > 0 ? `\n\n${text}` : text
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
  // `run.terminal.completed` is Muse's authoritative end-of-run record. A
  // `run.terminal.failed` (or a non-completed terminal) is an error and must
  // still go through the normal exit-code/error path.
  isTerminalEvent(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event || event.payload_type !== "run.terminal.completed") return false
    return museTerminalError(event) === undefined
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

// mcode 0.7.6+ nests the consolidated result under `exec.completed.result`
// (an `exec.result` object); older builds put status/output on the event.
function minimaxResult(event: CliJsonObject): Record<string, unknown> | undefined {
  if (event.type !== "exec.result" && event.type !== "exec.completed") return undefined
  return recordField(event, "result") ?? event
}

function minimaxResultOutput(event: CliJsonObject): string | undefined {
  const result = minimaxResult(event)
  return typeof result?.output === "string" ? result.output : undefined
}

// Completed items carry `text` (0.7.2) or `content` (0.7.6+).
function minimaxItemText(item: Record<string, unknown> | undefined): string | undefined {
  return stringField(item, "text") ?? stringField(item, "content")
}

function minimaxAssistantText(event: CliJsonObject): string | undefined {
  const result = minimaxResult(event)
  if (result) return minimaxResultOutput(event)
  const item = minimaxItem(event)
  if (!isMiniMaxAssistantItem(item)) return undefined
  return minimaxItemText(item)
}

function minimaxResultStatus(event: CliJsonObject): string | undefined {
  return stringField(minimaxResult(event), "status")
}

function minimaxTerminalError(event: CliJsonObject): string | undefined {
  if (event.type === "turn.failed") {
    const error = recordField(event, "error")
    return stringField(error, "message") ?? stringField(event, "message") ?? "MiniMax Code CLI turn failed"
  }
  const status = minimaxResultStatus(event)
  if (!status || status === "succeeded") return undefined
  const result = minimaxResult(event)
  const error = (result && recordField(result, "error")) ?? recordField(event, "error")
  return stringField(error, "message") ?? minimaxResultOutput(event) ?? `MiniMax Code CLI run ${status}`
}

// mcode echoes the effective model on `turn.completed` / `exec.completed`. It
// silently substitutes the provider default when `--model` names something it
// does not know, so a successful run can still be the wrong model.
function normalizeMiniMaxModelID(model: string): string {
  const bare = model.split("#")[0]!.trim()
  const withoutProvider = bare.startsWith("minimax/") ? bare.slice("minimax/".length) : bare
  return withoutProvider.toLowerCase()
}

function minimaxEffectiveModel(output: string): string | undefined {
  let effective: string | undefined
  for (const line of output.split("\n")) {
    const event = parseCliJsonEventLine(line)
    if (!event || (event.type !== "turn.completed" && event.type !== "exec.completed")) continue
    const source = event.type === "exec.completed" ? (recordField(event, "result") ?? event) : event
    effective = stringField(recordField(source, "model"), "modelId") ?? effective
  }
  return effective
}

function minimaxModelMismatch(output: string, requestedModel: string): string | undefined {
  if (!requestedModel || requestedModel === "minimax-cli") return undefined
  const effective = minimaxEffectiveModel(output)
  if (!effective) return undefined
  if (normalizeMiniMaxModelID(effective) === normalizeMiniMaxModelID(requestedModel)) return undefined
  return `MiniMax Code used ${effective} instead of the requested model ${requestedModel}`
}

// mcode reports `inputTokens` without the cached portion and a `cacheReadTokens`
// subset, so the input total is their sum. `totalTokens` in the capture equals
// inputTokens + cacheReadTokens + outputTokens.
function minimaxUsageFrom(value: Record<string, unknown> | undefined): CliUsage | undefined {
  if (!value) return undefined
  const input = numberField(value, "inputTokens")
  const output = numberField(value, "outputTokens")
  if (input === undefined && output === undefined) return undefined
  const cacheRead = numberField(value, "cacheReadTokens") ?? 0
  return {
    inputTokens: (input ?? 0) + cacheRead,
    outputTokens: output ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}

function minimaxUsage(output: string): CliUsage | undefined {
  let usage: CliUsage | undefined
  for (const line of output.split("\n")) {
    const event = parseCliJsonEventLine(line)
    if (!event) continue
    const value = recordField(event, "usage") ?? recordField(recordField(event, "result"), "usage")
    usage = minimaxUsageFrom(value) ?? usage
  }
  return usage
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
        const text = minimaxItemText(item)
        if (text) last = text
        continue
      }
      const resultText = minimaxResultOutput(event)
      if (resultText) fallback = resultText
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
    // text and is the complete-parse fallback. mcode 0.7.6+ sends the first
    // delta on item.started and names it `contentDelta`.
    if (event.type !== "item.started" && event.type !== "item.updated") return null
    return stringField(item, "delta") ?? stringField(item, "contentDelta") ?? stringField(event, "delta") ?? null
  },
  parseUsage: minimaxUsage,
  parseModelMismatch: minimaxModelMismatch,
}

// DeepSeek Harness headless `--json` events: `session`, `status`, `thinking`,
// `text`, `tool_call`, `tool_result`, then one `final` carrying the run's
// terminal `reason` and the last non-empty assistant text. Only `final` is
// authoritative; a run that never reaches it fell over before completing.
function dshFinalError(event: CliJsonObject): string | undefined {
  const reason = recordField(event, "reason")
  const kind = stringField(reason, "kind")
  if (!reason || kind === "completed") return undefined
  const error = isRecord(reason.error) ? reason.error : undefined
  const code = stringField(error, "code")
  const message = stringField(error, "message") ?? `run ended with reason "${kind ?? "unknown"}"`
  const detail = code ? `${code}: ${message}` : message
  if (code === "MISSING_CREDENTIAL")
    return `DeepSeek Harness has no API key (${detail}). Export DEEPSEEK_API_KEY or add it to ~/.dsh/.env, then retry.`
  return `DeepSeek Harness run failed: ${detail}`
}

export const dshCliParser: CliOutputParser = {
  parseComplete(output: string) {
    const parts: string[] = []
    let sawJsonEvent = false
    for (const line of output.split("\n")) {
      const event = parseCliJsonEventLine(line)
      if (!event) continue
      sawJsonEvent = true
      if (event.type === "final") {
        const error = dshFinalError(event)
        if (error) throw new CliOutputError(error)
        if (typeof event.text === "string" && event.text) return { text: event.text }
        continue
      }
      if (event.type === "text" && typeof event.text === "string" && event.text) parts.push(event.text)
    }
    if (parts.length) return { text: parts.join("\n") }
    if (sawJsonEvent) return { text: "" }
    return { text: rawCompleteText(output) }
  },
  parseStreamLine(line: string) {
    const event = parseCliJsonEventLine(line)
    if (!event) return null
    // `final` repeats the last assistant text already streamed as `text`;
    // failures exit nonzero and surface through the shared exit-code path.
    if (event.type === "text" && typeof event.text === "string" && event.text) return event.text
    return null
  },
}
