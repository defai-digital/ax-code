export type BackgroundTaskHandoffState = "running" | "completed" | "error"

export type BackgroundTaskHandoff = {
  taskID: string
  state: BackgroundTaskHandoffState
  title?: string
  resultText: string
  empty: boolean
  failed: boolean
  recoveredResultNeedsReview: boolean
}

const HANDOFF_RE =
  /<task\b([^>]*)>([\s\S]*?)<\/task>/gi
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g
const INNER_RE = {
  summary: /<summary>([\s\S]*?)<\/summary>/i,
  result: /<task_result>([\s\S]*?)<\/task_result>/i,
  error: /<task_error>([\s\S]*?)<\/task_error>/i,
}

export function needsRecoveredResultReview(text: string) {
  return /\b(?:incomplete|unresolved|insufficient|no usable|not enough evidence|unable to determine|could not verify|needs? validation|requires? validation)\b/i.test(
    text,
  )
}

export function isEmptySubagentResultText(text: string) {
  const trimmed = text.trim()
  return (
    trimmed.length === 0 ||
    trimmed.includes("Subagent completed without a final response.") ||
    trimmed.includes("Subagent failed before returning a usable result")
  )
}

export function childVisibleText(result: unknown): string {
  if (!result || typeof result !== "object") return ""
  const parts = (result as { parts?: unknown }).parts
  if (!Array.isArray(parts)) return ""
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index]
    if (!part || typeof part !== "object") continue
    const record = part as { type?: unknown; text?: unknown }
    if (record.type !== "text" || typeof record.text !== "string") continue
    const text = record.text.trim()
    if (text) return text
  }
  return ""
}

export function formatBackgroundTaskHandoff(input: {
  taskID: string
  title?: string
  state: Exclude<BackgroundTaskHandoffState, "running">
  text: string
  errorMessage?: string
}): string {
  const failed = input.state === "error"
  const resultText = failed
    ? input.errorMessage?.trim() || input.text.trim() || "Subagent failed before returning a usable result."
    : input.text.trim()
  const empty = failed || isEmptySubagentResultText(resultText)
  const recoveredResultNeedsReview = !failed && !empty && needsRecoveredResultReview(resultText)
  const summary = failed
    ? `Background task failed: ${input.title || "Subagent"}`
    : empty
      ? `Background task completed without a usable final response: ${input.title || "Subagent"}`
      : `Background task completed: ${input.title || "Subagent"}`
  const bodyTag = failed ? "task_error" : "task_result"
  const body = failed
    ? resultText
    : empty
      ? resultText || "Subagent completed without a final response."
      : resultText
  return [
    `<task id="${escapeAttr(input.taskID)}" state="${input.state}" empty="${empty ? "true" : "false"}"${
      recoveredResultNeedsReview ? ' needs_review="true"' : ""
    }>`,
    `<summary>${escapeBody(summary)}</summary>`,
    `<${bodyTag}>`,
    escapeBody(body),
    `</${bodyTag}>`,
    "</task>",
  ].join("\n")
}

export function parseBackgroundTaskHandoffs(text: string): BackgroundTaskHandoff[] {
  const found: BackgroundTaskHandoff[] = []
  for (const match of text.matchAll(HANDOFF_RE)) {
    const attrs = parseAttrs(match[1] ?? "")
    const taskID = attrs.id?.trim()
    const state = parseState(attrs.state)
    if (!taskID || !state || state === "running") continue
    const inner = match[2] ?? ""
    const resultText = unescapeBody(
      innerMatch(inner, INNER_RE.result) ?? innerMatch(inner, INNER_RE.error) ?? "",
    ).trim()
    const failed = state === "error"
    const empty =
      attrs.empty === "true" || failed || isEmptySubagentResultText(resultText)
    found.push({
      taskID,
      state,
      title: unescapeBody(innerMatch(inner, INNER_RE.summary) ?? "") || undefined,
      resultText,
      empty,
      failed,
      recoveredResultNeedsReview: attrs.needs_review === "true" || needsRecoveredResultReview(resultText),
    })
  }
  return found
}

function parseState(value: string | undefined): BackgroundTaskHandoffState | undefined {
  if (value === "running" || value === "completed" || value === "error") return value
  return undefined
}

function parseAttrs(raw: string) {
  const attrs: Record<string, string> = {}
  for (const match of raw.matchAll(ATTR_RE)) {
    const key = match[1]
    const value = match[2]
    if (key && value !== undefined) attrs[key] = value
  }
  return attrs
}

function innerMatch(text: string, pattern: RegExp) {
  return pattern.exec(text)?.[1]
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

function escapeBody(value: string) {
  return value.replace(/&/g, "&amp;").replace(/<\/task/gi, "&lt;/task")
}

function unescapeBody(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
}
