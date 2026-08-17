import type { PromptInfo } from "./history"
import { stringIndexFromDisplayOffset } from "./prompt-helpers"

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
const PROMPT_SUBMIT_KEY_NAMES = new Set(["return", "enter", "linefeed", "kpenter", "\r", "\n"])
const PROMPT_SUBMIT_KEY_SEQUENCES = new Set(["\r", "\n", "\r\n"])

export function isUnmodifiedPromptSubmitKey(input: {
  name?: string
  raw?: string
  sequence?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  super?: boolean
  hyper?: boolean
}) {
  if (input.ctrl || input.meta || input.shift || input.super || input.hyper) return false
  if (input.name && PROMPT_SUBMIT_KEY_NAMES.has(input.name)) return true
  if (input.name) return false
  return PROMPT_SUBMIT_KEY_SEQUENCES.has(input.raw ?? "") || PROMPT_SUBMIT_KEY_SEQUENCES.has(input.sequence ?? "")
}

export function sanitizePromptInput(input: string) {
  // SGR mouse residue: \x1b[<Cb;Cx;CyM/m can arrive as <digits;digits;digitsM
  // if the escape parser partially processes mouse input during focus changes.
  // The leading "<" is required: SGR mouse encoding always carries it, so anchoring
  // to it avoids eating legitimate content the user typed/pasted such as ANSI color
  // codes ("1;31;40m") or plain semicolon triples.
  return input.replace(/<\d+;\d+;\d+[Mm]/g, "")
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

export const DOUBLE_ESCAPE_REWIND_MS = 600

// The rewind gesture is two CONSECUTIVE escapes. Any other key must disarm the
// window — including keys the prompt key handler consumes before it reaches
// the escape-intent chain (submit, paste, shell-mode switch, autocomplete),
// which would otherwise leave a stale arm that a later lone Esc completes.
export function escapeRewindDisarmKey(keyName?: string) {
  return keyName !== "escape"
}

// Double-Esc on an idle session (with no draft) opens the rollback dialog.
// The first Esc only arms the window and must NOT be consumed by the caller —
// other escape behaviors (dialog close, selection clear) still apply to it.
export function promptEscapeRewindIntent(input: {
  keyName?: string
  hasDraft: boolean
  onSessionRoute: boolean
  sessionIdle: boolean
  previousIdleEscapeAt?: number
  now: number
  windowMs?: number
}): {
  action: "arm" | "rewind" | "passthrough"
  nextIdleEscapeAt?: number
} {
  if (input.keyName !== "escape") return { action: "passthrough" }
  if (input.hasDraft || !input.onSessionRoute || !input.sessionIdle) return { action: "passthrough" }

  const windowMs = input.windowMs ?? DOUBLE_ESCAPE_REWIND_MS
  if (input.previousIdleEscapeAt !== undefined && input.now - input.previousIdleEscapeAt <= windowMs) {
    return { action: "rewind" }
  }

  return {
    action: "arm",
    nextIdleEscapeAt: input.now,
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

export function createPromptPasteSubmitGate(input: { submit: () => void }) {
  let pasteInFlight = 0
  let submitAfterPaste = false

  return {
    beginPasteHandling() {
      pasteInFlight++
    },
    finishPasteHandling(options: { submitDeferred?: boolean } = {}) {
      pasteInFlight = Math.max(0, pasteInFlight - 1)
      if (pasteInFlight === 0 && options.submitDeferred === false) submitAfterPaste = false
      if (pasteInFlight > 0 || !submitAfterPaste) return
      submitAfterPaste = false
      input.submit()
    },
    deferSubmitUntilPasteHandled() {
      if (pasteInFlight === 0) return false
      submitAfterPaste = true
      return true
    },
  }
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
    // Extmark ranges are display-width offsets; convert to UTF-16 indices
    // before slicing so wide (CJK/emoji) characters before a placeholder
    // don't shift the replaced range and corrupt the submitted text.
    const start = stringIndexFromDisplayOffset(input.text, extmark.start)
    const end = Math.max(start, stringIndexFromDisplayOffset(input.text, extmark.end))

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
