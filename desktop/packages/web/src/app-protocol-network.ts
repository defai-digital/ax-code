const APP_PROTOCOL_PAGE_ORIGIN = "app://ax-code"

const LOOPBACK_API_PREFIXES = ["/api", "/health", "/global", "/dre-graph", "/graph", "/auth"]

export const isAppProtocolPageOrigin = (origin: string): boolean => origin === APP_PROTOCOL_PAGE_ORIGIN

const isLoopbackApiPath = (pathname: string): boolean =>
  LOOPBACK_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

export const rewriteAppProtocolNetworkUrl = (
  input: string,
  options: { pageOrigin: string; apiOrigin: string },
): string => {
  const pageOrigin = options.pageOrigin.replace(/\/+$/, "")
  const apiOrigin = options.apiOrigin.replace(/\/+$/, "")
  if (!isAppProtocolPageOrigin(pageOrigin) || !apiOrigin) return input

  const raw = typeof input === "string" ? input.trim() : ""
  if (!raw) return input

  if (raw.startsWith("/")) {
    const pathname = raw.split("?")[0] || "/"
    if (!isLoopbackApiPath(pathname)) return input
    return `${apiOrigin}${raw}`
  }

  try {
    const parsed = new URL(raw, `${pageOrigin}/`)
    const isAppPage = parsed.protocol === "app:" && parsed.hostname === "ax-code"
    if (!isAppPage && parsed.origin !== pageOrigin) return input
    if (!isLoopbackApiPath(parsed.pathname)) return input
    return `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return input
  }
}

export const rewriteAppProtocolWebSocketUrl = (
  input: string,
  options: { pageOrigin: string; apiOrigin: string },
): string => {
  const rewritten = rewriteAppProtocolNetworkUrl(input, options)
  if (rewritten === input) return input
  try {
    const parsed = new URL(rewritten)
    if (parsed.protocol === "http:") parsed.protocol = "ws:"
    if (parsed.protocol === "https:") parsed.protocol = "wss:"
    return parsed.toString()
  } catch {
    return rewritten
  }
}

export const installAppProtocolNetworkRewrites = (options: { pageOrigin: string; apiOrigin?: string }): void => {
  const apiOrigin = typeof options.apiOrigin === "string" ? options.apiOrigin.trim() : ""
  if (!isAppProtocolPageOrigin(options.pageOrigin) || !apiOrigin) return
  if (typeof window === "undefined") return

  const rewriteOptions = { pageOrigin: options.pageOrigin, apiOrigin }
  const originalFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      return originalFetch(rewriteAppProtocolNetworkUrl(input, rewriteOptions), init)
    }
    return originalFetch(input as RequestInfo, init)
  }) as typeof window.fetch

  const OriginalEventSource = window.EventSource
  if (typeof OriginalEventSource === "function") {
    window.EventSource = class extends OriginalEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(rewriteAppProtocolNetworkUrl(String(url), rewriteOptions), eventSourceInitDict)
      }
    } as typeof EventSource
  }

  const OriginalWebSocket = window.WebSocket
  if (typeof OriginalWebSocket === "function") {
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(rewriteAppProtocolWebSocketUrl(String(url), rewriteOptions), protocols)
      }
    } as typeof WebSocket
  }
}
