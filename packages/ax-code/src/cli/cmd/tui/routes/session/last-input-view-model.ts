import { stringWidth } from "@/bun/node-compat"

export type PinnedInputHeader = "hidden" | "session" | "subagent"
export type PinnedInputPreviewVisibility = "fully-visible" | "partial" | "offscreen" | "unknown"
export type PinnedInputHiddenReason =
  | "empty"
  | "pending-parts"
  | "reverted"
  | "truncated-revert"
  | "insufficient-space"
  | "preview-visible"

export type PinnedInputCandidate =
  | {
      state: "none"
      reason: Extract<PinnedInputHiddenReason, "empty" | "pending-parts" | "reverted" | "truncated-revert">
    }
  | {
      state: "ready"
      messageID: string
      text: string
    }

export type PinnedInputBanner =
  | {
      state: "hidden"
      reason: PinnedInputHiddenReason
    }
  | {
      state: "visible"
      messageID: string
      label: "Input"
      badge?: "autonomous"
      lines: string[]
      lineCount: 1 | 2
    }

type Message = {
  id: string
  role: string
}

type Part = {
  type?: string
  synthetic?: boolean
  ignored?: boolean
  text?: string
}

const MIN_SCROLL_ROWS = 10
const PADDING_ROWS = 2
const PROMPT_ROWS = 5
const SESSION_HEADER_ROWS = 5
const SUBAGENT_SESSION_HEADER_ROWS = 9
const TWO_LINE_MIN_COLUMNS = 72
const ONE_LINE_MIN_COLUMNS = 48
const SUBAGENT_MAX_PANEL_ROWS = 8
const SUBAGENT_MAX_TERMINAL_FRACTION = 0.15
const ELLIPSIS = "…"

function isVisibleTextPart(part: Part) {
  return part.type === "text" && !part.synthetic && !part.ignored && !!part.text?.trim()
}

function hasCompactionPart(parts: Part[]) {
  return parts.some((part) => part.type === "compaction")
}

function visibleText(parts: Part[] | undefined) {
  if (!parts) return ""
  let text = ""
  for (const part of parts) {
    if (!isVisibleTextPart(part)) continue
    text += part.text ?? ""
  }
  return normalizePreviewText(text)
}

export function normalizePreviewText(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

export function subagentPanelRows(input: { terminalHeight: number; activeCount: number; collapsed: boolean }) {
  if (input.activeCount <= 0) return 0
  if (input.collapsed) return 1
  const panelRows = Math.max(
    2,
    Math.min(SUBAGENT_MAX_PANEL_ROWS, Math.floor(input.terminalHeight * SUBAGENT_MAX_TERMINAL_FRACTION)),
  )
  const body = panelRows - 1
  if (input.activeCount <= body) return 1 + input.activeCount
  const visibleLimit = body > 1 ? body - 1 : body
  return 1 + visibleLimit + 1
}

export function sessionChromeRows(input: { header: PinnedInputHeader; subagentRows: number }) {
  const headerRows =
    input.header === "hidden" ? 0 : input.header === "subagent" ? SUBAGENT_SESSION_HEADER_ROWS : SESSION_HEADER_ROWS
  const paneCount = (headerRows > 0 ? 1 : 0) + (input.subagentRows > 0 ? 1 : 0) + 2
  const gaps = Math.max(0, paneCount - 1)
  return PADDING_ROWS + headerRows + input.subagentRows + PROMPT_ROWS + gaps
}

export function pinnedInputMaxLines(input: {
  terminalHeight: number
  contentColumns: number
  chromeRows: number
}): 0 | 1 | 2 {
  const scrollRowsWithoutBanner = input.terminalHeight - input.chromeRows
  if (scrollRowsWithoutBanner - 3 >= MIN_SCROLL_ROWS && input.contentColumns >= TWO_LINE_MIN_COLUMNS) return 2
  if (scrollRowsWithoutBanner - 2 >= MIN_SCROLL_ROWS && input.contentColumns >= ONE_LINE_MIN_COLUMNS) return 1
  return 0
}

export function messagePreviewVisibility(input: {
  y: number | undefined
  scrollTop: number
  viewportHeight: number
  previewRows: number
}): PinnedInputPreviewVisibility {
  if (input.y === undefined || input.viewportHeight <= 0) return "unknown"
  const top = input.y
  const bottom = input.y + Math.max(1, input.previewRows)
  const viewTop = input.scrollTop
  const viewBottom = input.scrollTop + input.viewportHeight
  if (bottom <= viewTop || top >= viewBottom) return "offscreen"
  if (top >= viewTop && bottom <= viewBottom) return "fully-visible"
  return "partial"
}

export function selectPinnedInputCandidate(input: {
  messages: Message[]
  partsByMessageID: Record<string, Part[] | undefined>
  hiddenIDs: ReadonlySet<string>
  revertMessageID?: string
  historyTruncated: boolean
}): PinnedInputCandidate {
  if (
    input.revertMessageID &&
    input.historyTruncated &&
    !input.messages.some((message) => message.id === input.revertMessageID)
  ) {
    return { state: "none", reason: "truncated-revert" }
  }

  const newestUser = input.messages.findLast((message) => message.role === "user" && !input.hiddenIDs.has(message.id))
  if (newestUser) {
    const parts = input.partsByMessageID[newestUser.id]
    if (parts === undefined || (parts.length === 0 && !hasCompactionPart(parts))) {
      return { state: "none", reason: "pending-parts" }
    }
  }

  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i]
    if (!message || message.role !== "user") continue
    if (input.hiddenIDs.has(message.id)) continue
    const text = visibleText(input.partsByMessageID[message.id])
    if (!text) continue
    return { state: "ready", messageID: message.id, text }
  }

  if (input.hiddenIDs.size > 0) return { state: "none", reason: "reverted" }
  return { state: "none", reason: "empty" }
}

function fitWidth(text: string, width: number) {
  if (width <= 0) return ""
  if (stringWidth(text) <= width) return text
  let out = ""
  let used = 0
  for (const ch of text) {
    const next = stringWidth(ch)
    if (used + next > width) break
    out += ch
    used += next
  }
  return out
}

export function truncateToCellWidth(text: string, width: number) {
  if (width <= 0) return ""
  if (stringWidth(text) <= width) return text
  const ellipsisWidth = stringWidth(ELLIPSIS)
  const budget = Math.max(1, width - ellipsisWidth)
  return fitWidth(text, budget) + ELLIPSIS
}

function wrapPreview(text: string, firstLineWidth: number, nextLineWidth: number, maxLines: 1 | 2) {
  const lines: string[] = []
  let remaining = text
  for (let index = 0; index < maxLines; index++) {
    const width = index === 0 ? firstLineWidth : nextLineWidth
    const last = index === maxLines - 1
    if (width <= 0) break
    if (stringWidth(remaining) <= width) {
      if (remaining) lines.push(remaining)
      break
    }
    if (last) {
      lines.push(truncateToCellWidth(remaining, width))
      break
    }
    const fitted = fitWidth(remaining, width)
    const breakAt = fitted.lastIndexOf(" ")
    const chunk = breakAt > 0 ? fitted.slice(0, breakAt) : fitted
    lines.push(chunk)
    remaining = remaining.slice(chunk.length).trimStart()
    if (!remaining) break
  }
  return lines
}

export function derivePinnedInputBanner(input: {
  candidate: PinnedInputCandidate
  autonomousActive: boolean
  contentColumns: number
  terminalHeight: number
  header: PinnedInputHeader
  subagentRows: number
  previewVisibility: PinnedInputPreviewVisibility
}): PinnedInputBanner {
  if (input.candidate.state === "none") {
    return { state: "hidden", reason: input.candidate.reason }
  }

  const chromeRows = sessionChromeRows({ header: input.header, subagentRows: input.subagentRows })
  const maxLines = pinnedInputMaxLines({
    terminalHeight: input.terminalHeight,
    contentColumns: input.contentColumns,
    chromeRows,
  })
  if (maxLines === 0) return { state: "hidden", reason: "insufficient-space" }
  if (input.previewVisibility === "fully-visible") return { state: "hidden", reason: "preview-visible" }

  const badge = input.autonomousActive ? ("autonomous" as const) : undefined
  const prefix = badge ? "Input · AUTONOMOUS " : "Input "
  const prefixWidth = stringWidth(prefix)
  const firstLineWidth = Math.max(0, input.contentColumns - prefixWidth)
  if (firstLineWidth < 8) return { state: "hidden", reason: "insufficient-space" }

  const wrapped = wrapPreview(input.candidate.text, firstLineWidth, input.contentColumns, maxLines)
  if (wrapped.length === 0) return { state: "hidden", reason: "empty" }

  const lines = wrapped.map((line, index) => (index === 0 ? prefix + line : line))
  return {
    state: "visible",
    messageID: input.candidate.messageID,
    label: "Input",
    badge,
    lines,
    lineCount: lines.length === 1 ? 1 : 2,
  }
}
