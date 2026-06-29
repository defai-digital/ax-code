import { API_ENDPOINTS, HTTP_DEFAULTS } from "./http"
import { isLoopbackHostname } from "./loopback"
import { extractLoopbackUrls } from "./url"

const ANSI_ESCAPE_PREFIX = String.fromCharCode(27)
const ANSI_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE_PREFIX}\\[[0-9;?]*[ -/]*[@-~]`, "g")
const PREVIEW_OUTPUT_PATTERN =
  /(?:➜\s*(?:Local|Network):)|\b(?:local|network|loopback|serving|listening|available|ready|started|running|server|vite|webpack|next\.js|astro|sveltekit|nuxt)\b/i
const PYTHON_HTTP_SERVER_PATTERN = /Serving HTTP on .*? port (\d{2,5})/i

export const buildTerminalPreviewScanState = (
  previousTail: string,
  data: string,
): { scanText: string; nextTail: string } => {
  const combined = `${previousTail}${data}`.replace(/\r\n|\r/g, "\n")
  const lines = combined.split("\n")
  const nextTail = combined.endsWith("\n") ? "" : (lines[lines.length - 1] ?? "").slice(-1024)
  return { scanText: combined, nextTail }
}

export const extractTerminalPreviewUrl = (text: string): string | null => {
  if (!text) return null

  const cleaned = text.replace(ANSI_ESCAPE_PATTERN, "")
  const pythonMatch = cleaned.match(PYTHON_HTTP_SERVER_PATTERN)
  if (pythonMatch?.[1]) {
    const port = Number.parseInt(pythonMatch[1], 10)
    if (Number.isFinite(port) && port > 0 && port <= 65535) {
      return `http://127.0.0.1:${port}/`
    }
  }

  const lines = cleaned.split("\n")
  for (const line of lines) {
    if (!PREVIEW_OUTPUT_PATTERN.test(line)) {
      continue
    }

    const matches = extractLoopbackUrls(line)
    if (matches.length === 0) {
      continue
    }

    const withPort = matches.find((url) => {
      try {
        return Boolean(new URL(url).port)
      } catch {
        return false
      }
    })
    return withPort ?? matches[0]
  }

  return null
}

export const isTerminalPreviewUrlAvailable = async (url: string, timeoutMs = 1500): Promise<boolean> => {
  if (!url) return false
  if (typeof window === "undefined") return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false
  }

  if (!isLoopbackHostname(parsed.hostname)) {
    return false
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(API_ENDPOINTS.system.probeUrl, {
      method: HTTP_DEFAULTS.method.post,
      headers: HTTP_DEFAULTS.headers.contentTypeJson,
      body: JSON.stringify({ url: parsed.toString() }),
      cache: HTTP_DEFAULTS.cache.noStore,
      signal: controller.signal,
    })
    if (!response.ok) {
      return false
    }

    const result = (await response.json().catch(() => null)) as { ok?: unknown } | null
    return result?.ok === true
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
  }
}
