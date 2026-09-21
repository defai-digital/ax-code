import stripAnsi from "strip-ansi"
import { stringWidth } from "@/bun/node-compat"

/** Turn order, not message length, determines timeline spacing. */
export function timelineWindow(count: number, height: number, active: number, atBottom = false) {
  const capacity = Math.max(0, Math.floor(height) - 2)
  if (count < 2 || capacity < 1) return []
  const size = Math.min(count, capacity)
  const tail = count - size
  // At the bottom the window favors the newest turns, but never excludes the active one.
  const start = atBottom
    ? Math.max(0, Math.min(active, tail))
    : Math.max(0, Math.min(tail, active - Math.floor(size / 2)))
  return Array.from({ length: size }, (_, index) => ({
    index: start + index,
    row: Math.floor((Math.floor(height) - size - 2) / 2) + 1 + index,
  }))
}

export function timelinePosition(turns: readonly { y: number }[], top: number, atBottom = false) {
  const active = Math.max(
    0,
    turns.findLastIndex((turn) => turn.y <= top),
  )
  const previous = turns.findLastIndex((turn) => turn.y < top)
  const next = atBottom ? -1 : turns.findIndex((turn) => turn.y > top)
  return { active, previous, next }
}

const PREVIEW_MAX_CHARS = 120
// Bound the scan so a huge pasted prompt costs O(scan), not O(prompt length).
const PREVIEW_SCAN_CHARS = 2048
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

/** First non-empty line, ANSI-stripped and whitespace-normalized, capped in code points. */
export function turnPreview(text: string, max = PREVIEW_MAX_CHARS) {
  const head = text.length > PREVIEW_SCAN_CHARS ? text.slice(0, PREVIEW_SCAN_CHARS) : text
  for (const raw of head.split("\n")) {
    const line = stripAnsi(raw).replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim()
    if (!line) continue
    const chars = Array.from(line)
    if (chars.length <= max) return line
    return `${chars.slice(0, max - 1).join("")}…`
  }
  return ""
}

/** Take the longest prefix of `text` fitting `width` display columns (code-point safe). */
function fitWidth(text: string, width: number) {
  let used = 0
  let taken = 0
  for (const ch of text) {
    const w = stringWidth(ch)
    if (used + w > width) break
    used += w
    taken += ch.length
  }
  return text.slice(0, taken)
}

/** At most two display lines; the second is ellipsized when content remains. */
function wrapPreview(preview: string, width: number) {
  const first = fitWidth(preview, width)
  const rest = preview.slice(first.length).trimStart()
  if (!rest) return [first]
  const second = fitWidth(rest, width)
  const remaining = rest.slice(second.length).trim()
  if (!remaining) return [first, second]
  return [first, `${fitWidth(second, Math.max(1, width - 1))}…`]
}

export function timelineCard(input: {
  preview: string
  timeLabel: string
  termWidth: number
  tickRow: number
  railHeight: number
}): { lines: string[]; width: number; height: number; top: number } | null {
  const preview = input.preview.trim()
  if (!preview) return null
  const textWidth = Math.max(16, Math.min(32, Math.floor(input.termWidth * 0.4)))
  const lines = wrapPreview(preview, textWidth)
  const contentWidth = Math.max(...lines.map(stringWidth), stringWidth(input.timeLabel))
  // Two border columns plus one column of padding on each side.
  const width = contentWidth + 4
  // One time header row, the preview rows, and the top/bottom border rows.
  const height = lines.length + 3
  if (height > input.railHeight) return null
  const top = Math.max(0, Math.min(input.tickRow - Math.floor(height / 2), input.railHeight - height))
  return { lines, width, height, top }
}
