/**
 * Pure rules for turning the WebMCP bridge on from the TUI (ADR-180): the
 * advisory Chrome notice shown before a connect, and the one-time hint shown
 * when a submitted prompt names a web page while the bridge is off. No solid
 * or renderer imports so the view-model layering check stays satisfied.
 */

export type WebMcpChromeStatus =
  | { state: "ready"; major?: number; executable: string }
  | { state: "outdated"; major: number; minimum: number }
  | { state: "missing"; minimum: number }
  | { state: "unreadable"; executable: string; reason: string }

export type WebMcpChromeNotice =
  | { key: "ui.webMcpChromeMissing"; params: { min: string } }
  | { key: "ui.webMcpChromeOutdated"; params: { major: string; min: string } }

/**
 * Only a confident "missing" or "outdated" answer produces a notice. An
 * unreadable binary says nothing about the user's setup, and the connect
 * itself reports a real failure on the chip.
 */
export function webMcpChromeNotice(status: WebMcpChromeStatus | undefined): WebMcpChromeNotice | undefined {
  if (!status) return undefined
  if (status.state === "missing") return { key: "ui.webMcpChromeMissing", params: { min: String(status.minimum) } }
  if (status.state === "outdated") {
    return {
      key: "ui.webMcpChromeOutdated",
      params: { major: String(status.major), min: String(status.minimum) },
    }
  }
  return undefined
}

const WEB_TARGET =
  /\bhttps?:\/\/[^\s<>"')]+|\b(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{2,5})?(?:\/|\b)|\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|ai)\b\/\S*/i

/** True when the prompt names a URL or a local dev server a browser could open. */
export function promptMentionsWebTarget(text: string): boolean {
  // Slash commands and shell input are never page requests.
  const trimmed = text.trimStart()
  if (trimmed.startsWith("/") || trimmed.startsWith("!")) return false
  return WEB_TARGET.test(text.slice(0, 4000))
}

export const WEBMCP_HINT_KEY = "webmcp_hint_shown"
export const WEBMCP_HINT_LIMIT = 3

/**
 * The hint is shown at most {@link WEBMCP_HINT_LIMIT} times across restarts
 * and once per TUI process, only while a bridge is configured but not
 * connected, and never when the prompt names no web target.
 */
export function webMcpHintDue(input: {
  text: string
  configured: boolean
  connected: boolean
  shownThisRun: boolean
  shownBefore: unknown
}): boolean {
  if (!input.configured || input.connected || input.shownThisRun) return false
  const count = typeof input.shownBefore === "number" && Number.isFinite(input.shownBefore) ? input.shownBefore : 0
  if (count >= WEBMCP_HINT_LIMIT) return false
  return promptMentionsWebTarget(input.text)
}
