export type TranscriptViewport = { scrollTop: number; scrollHeight: number; viewportHeight: number }
export type TranscriptFollowState = { sessionID: string; away: boolean; unread: boolean }

export function transcriptFollowLabel(input: { unread: boolean; columns: number; activity: string; bottom: string }) {
  const suffix = `↓ ${input.bottom} · esc`
  const choices = [
    input.unread ? `${input.activity} · ${suffix}` : suffix,
    input.unread ? `• ${suffix}` : suffix,
    input.unread ? "• ↓ · esc" : "↓ · esc",
    "↓",
  ]
  return choices.find((label) => stringWidth(label) <= input.columns) ?? ""
}

/** Geometry alone never counts as activity: resize and history prepend are not new output. */
export function updateTranscriptFollow(
  previous: TranscriptFollowState,
  sessionID: string,
  viewport: TranscriptViewport | undefined,
  activitySessionID?: string,
): TranscriptFollowState {
  const away =
    !!viewport &&
    viewport.viewportHeight > 0 &&
    viewport.scrollTop < Math.max(0, viewport.scrollHeight - viewport.viewportHeight)
  const unread = away && ((previous.sessionID === sessionID && previous.unread) || activitySessionID === sessionID)
  if (previous.sessionID === sessionID && previous.away === away && previous.unread === unread) return previous
  return { sessionID, away, unread }
}

export function isTranscriptEscape(key: {
  name: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  option?: boolean
  super?: boolean
  hyper?: boolean
}) {
  return key.name === "escape" && !key.ctrl && !key.meta && !key.shift && !key.option && !key.super && !key.hyper
}
import { stringWidth } from "@/bun/node-compat"
