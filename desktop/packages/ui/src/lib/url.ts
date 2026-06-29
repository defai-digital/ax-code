import { getTauriGlobal } from "@/lib/tauriGlobal"
import { isLoopbackHostname, normalizeLoopbackHostname } from "./loopback"

/**
 * Utility for opening external URLs with desktop shell support.
 * In Tauri desktop runtime, uses a narrow native command that only accepts
 * safe external URLs. Falls back to window.open() for web/runtime shims.
 * Falls back to window.open() for web runtime.
 */

const parseUrlSafely = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export const isExternalHttpUrl = (url: string): boolean => {
  const parsed = parseUrlSafely(url.trim())
  if (!parsed) {
    return false
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
}

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"])

const hasUrlUserInfo = (parsed: URL): boolean => parsed.username.length > 0 || parsed.password.length > 0

export const isSafeExternalUrl = (url: string): boolean => {
  const parsed = parseUrlSafely(url.trim())
  if (!parsed) {
    return false
  }
  return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) && !hasUrlUserInfo(parsed)
}

export const getExternalFaviconUrl = (url: string): string | null => {
  const parsed = parseUrlSafely(url.trim())
  if (!parsed || hasUrlUserInfo(parsed) || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return null
  }

  return `https://icons.duckduckgo.com/ip3/${parsed.hostname.toLowerCase()}.ico`
}

/**
 * Returns true when the URL is an http(s) URL pointing at a loopback host
 * (localhost, 127.0.0.0/8, 0.0.0.0, ::1). Used to decide whether to offer an in-app
 * preview pane instead of opening the system browser.
 */
export const isLoopbackHttpUrl = (url: string): boolean => {
  const parsed = parseUrlSafely(url.trim())
  if (!parsed) {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false
  }
  return isLoopbackHostname(parsed.hostname)
}

export const normalizeLoopbackPreviewUrl = (url: string): string | null => {
  const parsed = parseUrlSafely(url.trim())
  if (!parsed) {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    return null
  }

  const hostname = normalizeLoopbackHostname(parsed.hostname)
  if (hostname === "0.0.0.0" || hostname === "::" || hostname === "::1") {
    parsed.hostname = "127.0.0.1"
  }

  return parsed.toString()
}

const LOOPBACK_URL_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[(?:::1|::)\])(?::\d{2,5})?(?:\/[^\s<>"'`\u0000-\u001f]*)?/gi

const TRAILING_PUNCT = new Set([".", ",", ";", ":", "!", "?"])

const trimUrlTrailingPunctuation = (url: string): string => {
  let result = url
  while (result.length > 0) {
    const last = result[result.length - 1]
    if (last === ")" || last === "]" || last === "}" || last === ">") {
      const opener = last === ")" ? "(" : last === "]" ? "[" : last === "}" ? "{" : "<"
      const head = result.slice(0, -1)
      const opens = (head.match(new RegExp(`\\${opener}`, "g")) || []).length
      const closes = (head.match(new RegExp(`\\${last}`, "g")) || []).length
      if (opens > closes) break
      result = head
      continue
    }
    if (TRAILING_PUNCT.has(last)) {
      result = result.slice(0, -1)
      continue
    }
    break
  }
  return result
}

/**
 * Extracts loopback http(s) URLs from a free-text string. Returns unique URLs
 * in order of first appearance. Trailing punctuation that is unlikely to be
 * part of a real URL is stripped.
 */
export const extractLoopbackUrls = (text: string): string[] => {
  if (!text) {
    return []
  }
  const matches = text.match(LOOPBACK_URL_PATTERN)
  if (!matches || matches.length === 0) {
    return []
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of matches) {
    const cleaned = trimUrlTrailingPunctuation(raw)
    const normalized = cleaned ? normalizeLoopbackPreviewUrl(cleaned) : null
    if (!normalized) {
      continue
    }
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/**
 * Opens an external URL in the system browser.
 * In Tauri desktop runtime, uses desktop_open_external_url for proper handling.
 * Falls back to window.open() for web runtime.
 *
 * @param url - The URL to open
 * @returns Promise<boolean> - true if the URL was opened successfully
 */
export const openExternalUrl = async (url: string): Promise<boolean> => {
  if (typeof window === "undefined") {
    return false
  }

  const target = url.trim()
  if (!target) {
    return false
  }

  const parsed = parseUrlSafely(target)
  if (!parsed) {
    return false
  }

  if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) || hasUrlUserInfo(parsed)) {
    return false
  }

  const normalizedTarget = parsed.toString()

  const tauri = getTauriGlobal()
  if (tauri?.core?.invoke) {
    try {
      await tauri.core.invoke("desktop_open_external_url", { url: normalizedTarget })
      return true
    } catch {
      // Fall through to window.open
    }
  }

  try {
    window.open(normalizedTarget, "_blank", "noopener,noreferrer")
    return true
  } catch {
    return false
  }
}
