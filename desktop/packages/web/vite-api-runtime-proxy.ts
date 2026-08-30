// S2.4b (SPEC-2026-08-29-desktop-process-model-collapse §2 D3): dev-mode mirror
// of the packaged app:// longest-prefix API routing (S2.4a,
// desktop/packages/electron/src/api-prefix-router.js). The packaged handler
// sends runtime-shaped paths straight to the ax-code runtime; this plugin makes
// the Vite dev server classify requests with the SAME table (loaded from the
// electron package via createRequire — the router is intentionally pure CJS) so
// dev and packaged behavior stay in parity.
//
// Port pinning decision: this plugin supersedes the SPEC's "runtime port
// pinned in dev" note with a dynamic-safe mechanism. The web server publishes
// the runtime's current loopback origin + Basic credential to a dev-only
// upstream file (AX_CODE_DESKTOP_DEV_UPSTREAM_FILE, set by
// desktop/packages/electron/scripts/dev.mjs), rewritten atomically on every
// origin transition (server/lib/ax-code/dev-runtime-upstream.js). This plugin
// re-reads that file with a short TTL cache and invalidates the cache on proxy
// failure, so runtime restarts on a fresh OS-assigned port keep working
// without pinning anything.
//
// Fallback semantics (zero-extra-setup dev): with no upstream file — web
// server not booted yet, Vite run standalone, garbage file contents — every
// request goes to the web server exactly as before S2.4 (the web server still
// catch-all-proxies /api/* to the runtime). The upstream file is treated as
// untrusted input: safe parse, shape validation, loopback-origin enforcement.
//
// SSE streams unbuffered: proxied requests force `accept-encoding: identity`
// upstream and response bodies are piped straight through.

import fs from "node:fs"
import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createRequire } from "node:module"
import type { Plugin } from "vite"

import { isBenignProxySocketError, resolveDesktopApiProxyPort } from "./vite-api-ws-proxy"

export const DEV_RUNTIME_UPSTREAM_FILE_ENV = "AX_CODE_DESKTOP_DEV_UPSTREAM_FILE"

export interface DevRuntimeUpstream {
  origin: string
  authorization?: string
  updatedAt?: string
}

export interface DevApiRoute {
  target: "runtime" | "web"
  upstreamPath: string
}

interface ElectronApiPrefixRouter {
  routeApiRequest: (pathname: string, method?: string) => DevApiRoute
}

// Path prefixes this plugin owns. /auth and /health stay on vite's static
// proxy entries (web-only in the packaged table as well); everything else the
// packaged router classifies — /api/*, /global/*, /graph, /dre-graph — is
// dispatched here. The segment-boundary check keeps lookalikes like
// "/graphics" or "/apricot" on the Vite SPA pipeline.
const HANDLED_PREFIXES = ["/api", "/global", "/graph", "/dre-graph"]

export function shouldHandleDesktopDevApiPath(pathname: string): boolean {
  return HANDLED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

// Load the electron router once at module scope. If the require ever fails
// (e.g. the file moved), classification degrades to the pre-S2.4 behavior —
// everything to the web server — instead of breaking the dev server.
const electronRouter: ElectronApiPrefixRouter | null = (() => {
  try {
    const require = createRequire(import.meta.url)
    return require("../electron/src/api-prefix-router.js") as ElectronApiPrefixRouter
  } catch {
    return null
  }
})()

// Classify exactly like the packaged app:// handler. Falls back to the safe
// "web" target when the router is unavailable.
export function classifyDesktopDevApiPath(pathname: string, method = "GET"): DevApiRoute {
  if (!electronRouter) {
    return { target: "web", upstreamPath: pathname }
  }
  return electronRouter.routeApiRequest(pathname, method)
}

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "localhost" || normalized === "::1") return true
  const parts = normalized.split(".")
  if (parts.length !== 4) return false
  const nums = parts.map(Number)
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && nums[0] === 127
}

// Safe parse of the dev upstream file (untrusted input): any parse failure,
// shape mismatch, non-loopback origin, or malformed credential yields null —
// the caller then falls back to the web server target.
export function parseDevRuntimeUpstream(raw: string): DevRuntimeUpstream | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.version !== 1) return null
  if (typeof candidate.origin !== "string" || candidate.origin.length === 0) return null

  let originUrl: URL
  try {
    originUrl = new URL(candidate.origin)
  } catch {
    return null
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return null
  if (!isLoopbackHostname(originUrl.hostname)) return null
  // Only an origin is allowed — no path/query the file could smuggle in.
  if (originUrl.pathname !== "/" && originUrl.pathname !== "") return null
  if (originUrl.search || originUrl.hash || originUrl.username || originUrl.password) return null

  const upstream: DevRuntimeUpstream = { origin: originUrl.origin }
  if (typeof candidate.authorization === "string" && candidate.authorization.startsWith("Basic ")) {
    upstream.authorization = candidate.authorization
  }
  if (typeof candidate.updatedAt === "string") {
    upstream.updatedAt = candidate.updatedAt
  }
  return upstream
}

export interface DevRuntimeUpstreamReader {
  read: () => DevRuntimeUpstream | null
  invalidate: () => void
}

// Re-reads the upstream file at most once per cacheMs; a missing, unreadable,
// or invalid file reads as null (web fallback). invalidate() forces the next
// read to hit disk — used after a runtime proxy failure so a just-rewritten
// file (runtime restarted on a new port) is picked up immediately.
export function createDevRuntimeUpstreamReader(options: {
  filePath?: string | null
  cacheMs?: number
  now?: () => number
}): DevRuntimeUpstreamReader {
  const filePath = typeof options.filePath === "string" && options.filePath.trim() ? options.filePath.trim() : null
  const cacheMs =
    Number.isFinite(options.cacheMs) && (options.cacheMs as number) > 0 ? (options.cacheMs as number) : 250
  const now = options.now ?? Date.now

  let cachedAt = 0
  let cachedValue: DevRuntimeUpstream | null = null

  const readFromDisk = (): DevRuntimeUpstream | null => {
    if (!filePath) return null
    let raw: string
    try {
      raw = fs.readFileSync(filePath, "utf8")
    } catch {
      return null
    }
    return parseDevRuntimeUpstream(raw)
  }

  return {
    read() {
      const timestamp = now()
      if (timestamp - cachedAt < cacheMs) {
        return cachedValue
      }
      cachedAt = timestamp
      cachedValue = readFromDisk()
      return cachedValue
    },
    invalidate() {
      cachedAt = 0
    },
  }
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export interface ForwardTarget {
  origin: string
  path: string
  // Extra headers applied last (e.g. the runtime Basic credential).
  headers?: Record<string, string>
  // Strip the renderer Origin header (runtime target, mirrors packaged mode).
  stripOrigin?: boolean
  // Strip the incoming Authorization header (runtime target). The renderer
  // never holds the runtime credential, so its Authorization must never reach
  // the runtime upstream — the injected credential (target.headers), applied
  // afterwards, is the only one allowed through. Mirrors the packaged
  // handler's delete-then-inject order.
  stripAuthorization?: boolean
}

// Streams one request to a loopback target. Response bodies — SSE included —
// are piped through unbuffered; `accept-encoding: identity` keeps upstreams
// from compressing event streams. onError fires only when nothing has been
// written to the client yet, so the caller may retry against a fallback.
export function forwardDesktopDevApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  target: ForwardTarget,
  onError: (error: unknown) => void,
): void {
  let targetUrl: URL
  try {
    targetUrl = new URL(target.origin)
  } catch (error) {
    onError(error)
    return
  }

  const headers: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue
    const lowerKey = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue
    if (lowerKey === "host" || lowerKey === "accept-encoding") continue
    if (target.stripOrigin && lowerKey === "origin") continue
    if (target.stripAuthorization && lowerKey === "authorization") continue
    headers[key] = value
  }
  headers["host"] = targetUrl.host
  headers["accept-encoding"] = "identity"
  if (target.headers) {
    Object.assign(headers, target.headers)
  }

  const proxyReq = http.request({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    method: req.method,
    path: target.path,
    headers,
  })

  let responded = false

  proxyReq.on("response", (proxyRes) => {
    responded = true
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, proxyRes.headers)
    proxyRes.pipe(res)
  })

  proxyReq.on("error", (error) => {
    // Detach the request stream so a fallback retry never writes into the
    // destroyed upstream request.
    try {
      req.unpipe(proxyReq)
    } catch {}
    if (responded || res.headersSent) {
      // Mid-stream failure: nothing safe left to do but drop the connection.
      res.destroy()
      return
    }
    onError(error)
  })

  req.on("aborted", () => {
    proxyReq.destroy()
  })

  req.pipe(proxyReq)
}

const endWithBadGateway = (res: ServerResponse, error: unknown) => {
  if (!isBenignProxySocketError(error)) {
    console.error("[vite] desktop api proxy error:", error instanceof Error ? error.message : error)
  }
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.statusCode = 502
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify({ error: "Bad Gateway" }))
}

// A failed runtime proxy can only be retried against the web server when the
// request carries no body: once req has been piped into the dead upstream,
// body bytes may be partially consumed and cannot be replayed safely.
const hasRequestBody = (req: IncomingMessage): boolean => {
  const contentLength = Number.parseInt(
    typeof req.headers["content-length"] === "string" ? req.headers["content-length"] : "",
    10,
  )
  return (Number.isFinite(contentLength) && contentLength > 0) || req.headers["transfer-encoding"] != null
}

export function createDesktopApiRuntimeProxyPlugin(options: { upstreamFilePath?: string | null } = {}): Plugin {
  const webTarget = `http://127.0.0.1:${resolveDesktopApiProxyPort()}`
  const reader = createDevRuntimeUpstreamReader({
    filePath: options.upstreamFilePath ?? process.env[DEV_RUNTIME_UPSTREAM_FILE_ENV] ?? null,
  })

  const forwardToWeb = (req: IncomingMessage, res: ServerResponse) => {
    forwardDesktopDevApiRequest(req, res, { origin: webTarget, path: req.url ?? "/" }, (error) => {
      endWithBadGateway(res, error)
    })
  }

  return {
    name: "desktop-api-runtime-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname: string
        try {
          pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname
        } catch {
          next()
          return
        }
        if (!shouldHandleDesktopDevApiPath(pathname)) {
          next()
          return
        }

        const route = classifyDesktopDevApiPath(pathname, req.method)
        if (route.target === "runtime") {
          const upstream = reader.read()
          if (upstream) {
            // Preserve the query string; routeApiRequest classifies the path only.
            const queryIndex = (req.url ?? "").indexOf("?")
            const query = queryIndex >= 0 ? (req.url ?? "").slice(queryIndex) : ""
            forwardDesktopDevApiRequest(
              req,
              res,
              {
                origin: upstream.origin,
                path: `${route.upstreamPath}${query}`,
                stripOrigin: true,
                stripAuthorization: true,
                headers: upstream.authorization ? { Authorization: upstream.authorization } : undefined,
              },
              (error) => {
                // The file may be stale (runtime restarted on a new port, or
                // died before the writer removed the file). Force a re-read so
                // the next request sees the fresh origin, and serve this one
                // via the web server — exactly the pre-S2.4 behavior. Bodied
                // requests cannot be replayed (see hasRequestBody), so they
                // surface as a 502 the renderer can retry.
                reader.invalidate()
                if (hasRequestBody(req)) {
                  endWithBadGateway(res, error)
                  return
                }
                if (!isBenignProxySocketError(error)) {
                  console.warn("[vite] runtime upstream unreachable; falling back to the web server for this request")
                }
                forwardToWeb(req, res)
              },
            )
            return
          }
        }

        // web target, or runtime target without a usable upstream file.
        forwardToWeb(req, res)
      })
    },
  }
}
