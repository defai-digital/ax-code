import type { AssistantMessage, Part, UserMessage } from "@ax-code/sdk/v2"
import stripAnsi from "strip-ansi"
import { userRoute, type AgentInfo } from "./route"
import { filetype } from "./format"
import { formatTokenCount, formatTokenRate } from "./footer-view-model"
import { DECODE_RATE_MIN_TOKENS, DECODE_RATE_MIN_WINDOW_MS, turnDecodeStats } from "./step-windows"
import { Locale } from "@/util/locale"
import { parseTuiJsonPayload } from "../../util/json"

/** Truecolor / cursor CSI in model text wraps into a leftover gutter beside the transcript. */
export function transcriptDisplayText(content: string) {
  return stripAnsi(content)
}

type TodoViewItem = {
  status: string
  content: string
}

type Message = {
  id: string
  role: string
}

type TextPart = Extract<Part, { type: "text" }>
type FilePart = Extract<Part, { type: "file" }>

export type SessionTaskSummary = {
  running: number
  done: number
  total: number
}

export type AssistantToolSummaryItem = {
  name: string
  count: number
  label: string
}

export type UserMetadataPreference = "auto" | "full" | "compact"
export type UserMetadataDensity = "full" | "compact"

export type TodoWriteView =
  | {
      state: "pending"
      todos: TodoViewItem[]
    }
  | {
      state: "items" | "empty"
      todos: TodoViewItem[]
    }

export type DiffDisplayView = {
  view: "split" | "unified"
  filetype: string
  wrapMode: "word" | "none"
}

export type CodeDisplayView = {
  filetype: string
  content: string
}

function isTextPart(part: Part): part is TextPart {
  return part.type === "text" && !part.synthetic
}

function isFilePart(part: Part): part is FilePart {
  return part.type === "file"
}

export function sessionTaskSummary(messages: Message[], parts: Record<string, Part[] | undefined>): SessionTaskSummary {
  let running = 0
  let done = 0

  for (const message of messages) {
    for (const part of parts[message.id] ?? []) {
      if (part.type !== "tool" || part.tool !== "task") continue
      const status = part.state.status
      if (status === "running" || status === "pending") running++
      else if (status === "completed") done++
    }
  }

  return { running, done, total: running + done }
}

export function parseTodoViewItems(value: unknown): TodoViewItem[] | undefined {
  if (!Array.isArray(value)) return
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const todo = item as Partial<TodoViewItem>
    if (typeof todo.status !== "string" || typeof todo.content !== "string") return []
    return [{ status: todo.status, content: todo.content }]
  })
}

export function parseTodoOutput(output: string | undefined): TodoViewItem[] | undefined {
  const parsed = parseTuiJsonPayload(output)
  return parsed === undefined ? undefined : parseTodoViewItems(parsed)
}

export function todoWriteView(input: {
  status: string
  inputTodos?: unknown
  metadataTodos?: unknown
  output?: string
}): TodoWriteView {
  const resolved =
    parseTodoViewItems(input.metadataTodos) ?? parseTodoViewItems(input.inputTodos) ?? parseTodoOutput(input.output)
  if (resolved) {
    return {
      state: resolved.length > 0 ? "items" : "empty",
      todos: resolved,
    }
  }
  return {
    state: input.status === "completed" ? "empty" : "pending",
    todos: [],
  }
}

export function assistantMessageDuration(
  message: AssistantMessage,
  messages: Array<Pick<Message, "id" | "role"> & { time?: { created?: number } }>,
) {
  if (!message.finish || ["tool-calls", "unknown"].includes(message.finish)) return 0
  if (!message.time.completed) return 0
  const user = messages.find((item) => item.role === "user" && item.id === message.parentID)
  if (!user?.time?.created) return 0
  return message.time.completed - user.time.created
}

export type AssistantMessageStats = { output?: string; rate?: string; firstToken?: string; cacheHit?: string }

// Per-message throughput/cache readout for the assistant footer line. The
// rate is DECODE tokens per second (visible output + reasoning — the same
// population the decode windows span) pooled over per-step first→last-token
// windows, so provider setup, local model load, prefill, and tool execution
// never enter the denominator. The wait to the first output token — where
// model load and prefill actually live — is reported separately as
// firstToken. Rates are gated on ≥ DECODE_RATE_MIN_TOKENS and
// ≥ DECODE_RATE_MIN_WINDOW_MS because tiny samples produce confidently wrong
// numbers. cacheHit uses cache.read, which local servers (ax-engine) fill
// with prefix-cache hits.
export function assistantMessageStats(
  message: AssistantMessage,
  parts?: readonly unknown[],
): AssistantMessageStats | undefined {
  const stats: AssistantMessageStats = {}
  const output = message.tokens.output
  if (output > 0) {
    stats.output = formatTokenCount(output)
    if (message.time.completed) {
      const decode = turnDecodeStats({
        parts: parts ?? [],
        created: message.time.created,
        completed: message.time.completed,
        outputTokens: output,
        reasoningTokens: message.tokens.reasoning,
      })
      if (decode.tokens >= DECODE_RATE_MIN_TOKENS && decode.ms >= DECODE_RATE_MIN_WINDOW_MS) {
        stats.rate = formatTokenRate(decode.tokens / (decode.ms / 1000))
      }
      if (decode.firstTokenMs !== undefined) {
        stats.firstToken = Locale.duration(decode.firstTokenMs)
      }
    }
  }
  const read = message.tokens.cache.read
  const fresh = message.tokens.input
  if (read > 0 && read + fresh > 0) {
    stats.cacheHit = `${Math.round((read / (read + fresh)) * 100)}%`
  }
  if (!stats.output && !stats.rate && !stats.firstToken && !stats.cacheHit) return undefined
  return stats
}

const TOOL_SUMMARY_LABELS: Record<string, [string, string]> = {
  read: ["read", "reads"],
  edit: ["edit", "edits"],
  write: ["write", "writes"],
  bash: ["cmd", "cmds"],
  glob: ["glob", "globs"],
  grep: ["grep", "greps"],
  list: ["list", "lists"],
  task: ["delegation", "delegations"],
  webfetch: ["fetch", "fetches"],
  websearch: ["search", "searches"],
  codesearch: ["search", "searches"],
  todowrite: ["todo", "todos"],
}

export function assistantToolSummaryLabel(name: string, count: number): string {
  const pair = TOOL_SUMMARY_LABELS[name]
  if (pair) return pair[count === 1 ? 0 : 1]
  return name
}

export function assistantToolSummary(parts: Part[], limit = 3): AssistantToolSummaryItem[] {
  const counts = new Map<string, number>()
  for (const part of parts) {
    if (part.type !== "tool") continue
    counts.set(part.tool, (counts.get(part.tool) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({
      name,
      count,
      label: assistantToolSummaryLabel(name, count),
    }))
}

export function userMessageView(input: {
  message: UserMessage
  parts: Part[]
  agents?: AgentInfo[]
  pending?: string
  showTimestamps: boolean
  width?: number
  metadataPreference?: UserMetadataPreference
}) {
  const text = input.parts.find(isTextPart)
  const files = input.parts.filter(isFilePart)
  const compaction = input.parts.find((part) => part.type === "compaction")
  const queued = !!input.pending && input.message.id > input.pending
  const route = userRoute(input.message, input.parts, input.agents)
  const showPrimary = input.message.agent !== "build" || route.delegated.length > 0
  const metadataVisible = queued || input.showTimestamps || showPrimary || route.delegated.length > 0
  const metadataDensity = userMessageMetadataDensity({
    width: input.width ?? Number.MAX_SAFE_INTEGER,
    preference: input.metadataPreference ?? "auto",
  })

  return {
    text,
    files,
    compaction,
    queued,
    route,
    showPrimary,
    metadataVisible,
    metadataDensity,
    compactDelegatedLabel: compactDelegatedLabel(route.delegated.length),
  }
}

export function userMessageMetadataDensity(input: {
  width: number
  preference: UserMetadataPreference
}): UserMetadataDensity {
  if (input.preference === "full") return "full"
  if (input.preference === "compact") return "compact"
  return input.width < 100 ? "compact" : "full"
}

export function compactDelegatedLabel(count: number) {
  if (count <= 0) return
  return count === 1 ? "1 delegated" : `${count} delegated`
}

export function diffDisplayView(input: {
  diffStyle: string | undefined
  width: number
  filePath?: string
  wrapMode: "word" | "none"
}): DiffDisplayView {
  return {
    view: input.diffStyle === "stacked" || input.width <= 120 ? "unified" : "split",
    filetype: filetype(input.filePath),
    wrapMode: input.wrapMode,
  }
}

export function codeDisplayView(input: { filePath?: string; content?: string }): CodeDisplayView {
  return {
    filetype: filetype(input.filePath),
    content: transcriptDisplayText(input.content ?? ""),
  }
}

export type StreamingTextRenderMode = "plain" | "markdown" | "code"

// While a text/reasoning part is still streaming, paint the throttled
// snapshot as plain text (a cheap wrap + buffer write per frame) and mount
// the rich markdown/code renderer exactly once at finalize. Re-running the
// full markdown/highlight pipeline per painted frame is what made long
// streams look frozen (see the 2026-08-13 Kimi-vs-engine review, principle A).
export function streamingTextRenderMode(input: {
  final: boolean
  experimentalMarkdown: boolean
}): StreamingTextRenderMode {
  if (!input.final) return "plain"
  return input.experimentalMarkdown ? "markdown" : "code"
}

/** A finished reply folds by default once it exceeds this many lines. */
export const TRANSCRIPT_FOLD_LINE_LIMIT = 50

export type TranscriptFoldView = {
  /** The reply is long enough that folding is offered. */
  foldable: boolean
  /** The reply is currently rendered folded (head lines plus an ellipsis). */
  folded: boolean
  /** Lines the fold hides; 0 when unfolded. */
  hiddenLines: number
  visibleText: string
}

/**
 * Fold policy for one text part.
 *
 * Folding is a *history* affordance: a part that was already final when it
 * mounted (`finalAtMount`) has no reader waiting on it, so it folds by
 * default. A part the user watched stream must not fold when it finalizes —
 * the fold used to fire on `isFinal()`, so a long answer lost most of its rows
 * and the sticky bottom re-anchored at the exact moment the turn completed.
 * Kimi Code's transcript follows the same rule: cap the height before content
 * grows, never shrink afterwards (`components/messages/tool-call.ts`).
 *
 * The caller renders the toggle row whenever `foldable` is true, so the row
 * count does not change when a part finalizes either. `userFold` is the
 * explicit toggle and wins in both directions; `undefined` follows the
 * default for that part.
 */
export function transcriptFoldView(input: {
  lines: readonly string[]
  finalAtMount: boolean
  userFold: boolean | undefined
}): TranscriptFoldView {
  const foldable = input.lines.length > TRANSCRIPT_FOLD_LINE_LIMIT
  const folded = foldable && (input.userFold ?? input.finalAtMount)
  const text = input.lines.join("\n")
  if (!folded) return { foldable, folded: false, hiddenLines: 0, visibleText: text }
  return {
    foldable,
    folded: true,
    hiddenLines: input.lines.length - TRANSCRIPT_FOLD_LINE_LIMIT,
    visibleText: input.lines.slice(0, TRANSCRIPT_FOLD_LINE_LIMIT).join("\n") + "\n...",
  }
}
