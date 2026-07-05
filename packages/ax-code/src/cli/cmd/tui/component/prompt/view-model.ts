import type { PromptInfo } from "./history"

export type PromptExtmark = {
  id: number
  start: number
  end: number
}

export type PromptSubmissionView = {
  text: string
  parts: PromptInfo["parts"]
}

export type ClipboardContentView = {
  data: string
  mime: string
}

export const DOUBLE_ESCAPE_CLEAR_MS = 3_000
const PROMPT_SUBMIT_KEY_NAMES = new Set(["return", "enter", "linefeed", "kpenter"])

export function isUnmodifiedPromptSubmitKey(input: {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  super?: boolean
  hyper?: boolean
}) {
  if (!input.name) return false
  if (input.ctrl || input.meta || input.shift || input.super || input.hyper) return false
  return PROMPT_SUBMIT_KEY_NAMES.has(input.name)
}

export function sanitizePromptInput(input: string) {
  // SGR mouse residue: \x1b[<Cb;Cx;CyM/m can arrive as <digits;digits;digitsM
  // if the escape parser partially processes mouse input during focus changes.
  return input.replace(/(?:<)?\d+;\d+;\d+[Mm]/g, "")
}

export function promptEscapeClearIntent(input: {
  keyName?: string
  hasDraft: boolean
  previousEscapeAt?: number
  now: number
  windowMs?: number
}): {
  action: "arm" | "clear" | "passthrough"
  nextEscapeAt?: number
} {
  if (input.keyName !== "escape") return { action: "passthrough" }
  if (!input.hasDraft) return { action: "passthrough" }

  const windowMs = input.windowMs ?? DOUBLE_ESCAPE_CLEAR_MS
  if (input.previousEscapeAt !== undefined && input.now - input.previousEscapeAt <= windowMs) {
    return { action: "clear" }
  }

  return {
    action: "arm",
    nextEscapeAt: input.now,
  }
}

export function isPromptExitCommand(input: string) {
  const trimmed = input.trim()
  return trimmed === "exit" || trimmed === "quit" || trimmed === ":q"
}

export function windowsClipboardTextPaste(input: {
  content: ClipboardContentView | undefined
  platform: NodeJS.Platform
}) {
  if (input.platform !== "win32") return undefined
  if (input.content?.mime !== "text/plain") return undefined

  const text = input.content.data.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  return text.trim().length > 0 ? text : undefined
}

export function promptSubmissionView(input: {
  text: string
  parts: PromptInfo["parts"]
  extmarks: PromptExtmark[]
  extmarkToPartIndex: ReadonlyMap<number, number>
}): PromptSubmissionView {
  let text = ""
  let cursor = 0
  const sorted = [...input.extmarks].sort((a, b) => a.start - b.start || a.end - b.end)

  for (const extmark of sorted) {
    const partIndex = input.extmarkToPartIndex.get(extmark.id)
    if (partIndex === undefined) continue
    const part = input.parts[partIndex]
    if (part?.type !== "text" || !part.text) continue
    const start = Math.max(0, Math.min(extmark.start, input.text.length))
    const end = Math.max(start, Math.min(extmark.end, input.text.length))

    // extmarks are expected to be non-overlapping. If they do overlap, keep
    // the first span and skip later conflicting replacements instead of
    // corrupting the reconstructed prompt text.
    if (start < cursor) continue

    text += input.text.slice(cursor, start)
    text += part.text
    cursor = end
  }

  text += input.text.slice(cursor)

  return {
    text,
    parts: input.parts.filter((part) => part.type !== "text"),
  }
}
