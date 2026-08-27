"use strict"

const path = require("path")
const { isLoopbackDesktopHostname } = require("./desktop-hosts")
const {
  isTrustedRendererNavigationUrl: isTrustedLoopbackRendererNavigationUrl,
} = require("./renderer-navigation-policy")

const PACKAGED_RENDERER_SCHEME = "app"
const PACKAGED_RENDERER_HOST = "ax-code"
const PACKAGED_RENDERER_ORIGIN = `${PACKAGED_RENDERER_SCHEME}://${PACKAGED_RENDERER_HOST}`
const RENDERER_API_ORIGIN_ARG_PREFIX = "--ax-code-desktop-api-origin="
const LOOPBACK_API_PREFIXES = ["/api", "/health", "/global", "/dre-graph", "/graph", "/auth"]

const PACKAGED_RENDERER_PRIVILEGED_SCHEMES = [
  {
    scheme: PACKAGED_RENDERER_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]

const LOOPBACK_CONNECT_SRC = [
  "'self'",
  "http://127.0.0.1:*",
  "http://localhost:*",
  "http://[::1]:*",
  "https://127.0.0.1:*",
  "https://localhost:*",
  "https://[::1]:*",
  "ws://127.0.0.1:*",
  "ws://localhost:*",
  "ws://[::1]:*",
  "wss://127.0.0.1:*",
  "wss://localhost:*",
  "wss://[::1]:*",
]

const isPackagedRendererOrigin = (raw) => {
  const value = typeof raw === "string" ? raw.trim() : ""
  return value === PACKAGED_RENDERER_ORIGIN
}

const isPackagedRendererUrl = (raw) => {
  try {
    const parsed = new URL(String(raw || ""))
    return parsed.protocol === `${PACKAGED_RENDERER_SCHEME}:` && parsed.hostname === PACKAGED_RENDERER_HOST
  } catch {
    return false
  }
}

const isTrustedRendererNavigationUrl = (raw, options = {}) => {
  if (isPackagedRendererUrl(raw)) return true
  return isTrustedLoopbackRendererNavigationUrl(raw, options)
}

const isLoopbackApiPath = (pathname) => {
  const value = typeof pathname === "string" ? pathname : ""
  return LOOPBACK_API_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))
}

const buildRendererApiOrigin = (port) => {
  const parsed = Number(port)
  if (!Number.isInteger(parsed) || parsed <= 0) return ""
  return `http://127.0.0.1:${parsed}`
}

const buildRendererApiOriginAdditionalArguments = (port) => {
  const origin = buildRendererApiOrigin(port)
  return origin ? [`${RENDERER_API_ORIGIN_ARG_PREFIX}${origin}`] : []
}

const readRendererApiOriginFromArgv = (argv, env = process.env) => {
  const args = Array.isArray(argv) ? argv : []
  for (const arg of args) {
    if (typeof arg === "string" && arg.startsWith(RENDERER_API_ORIGIN_ARG_PREFIX)) {
      const origin = arg.slice(RENDERER_API_ORIGIN_ARG_PREFIX.length).trim().replace(/\/+$/, "")
      if (origin) return origin
    }
  }
  const fromEnv =
    typeof env?.AX_CODE_DESKTOP_RENDERER_API_ORIGIN === "string"
      ? env.AX_CODE_DESKTOP_RENDERER_API_ORIGIN.trim().replace(/\/+$/, "")
      : ""
  return fromEnv
}

const buildPackagedRendererCsp = () => {
  const connectSrc = LOOPBACK_CONNECT_SRC.join(" ")
  return [
    `default-src 'self' ${PACKAGED_RENDERER_ORIGIN}`,
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${PACKAGED_RENDERER_ORIGIN} data: blob:`,
    `font-src 'self' ${PACKAGED_RENDERER_ORIGIN} data:`,
    `connect-src ${connectSrc}`,
    "media-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join("; ")
}

const parseCspDirective = (csp, name) => {
  const directives = String(csp || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
  const match = directives.find((directive) => directive.toLowerCase().startsWith(`${name.toLowerCase()} `))
  if (!match) return []
  return match.slice(name.length).trim().split(/\s+/).filter(Boolean)
}

const isLoopbackConnectSrc = (source) => {
  if (source === "'self'") return true
  try {
    const normalized = source.replace(":*", ":1")
    const parsed = new URL(normalized)
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) return false
    return isLoopbackDesktopHostname(parsed.hostname)
  } catch {
    return false
  }
}

const resolvePackagedRendererAssetPath = (webDistPath, requestPath) => {
  const root = path.resolve(String(webDistPath || ""))
  let pathname = typeof requestPath === "string" ? requestPath : "/"
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    return { ok: false, error: "invalid-path" }
  }
  if (!pathname || pathname === "/") pathname = "/index.html"
  const segments = pathname.split("/")
  if (
    segments.some((segment) => {
      try {
        const decoded = decodeURIComponent(segment)
        return decoded === ".." || decoded === "."
      } catch {
        return segment === ".." || segment === "."
      }
    })
  ) {
    return { ok: false, error: "path-escape" }
  }
  const relative = pathname.replace(/^\/+/, "")
  const resolved = path.resolve(root, relative)
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    return { ok: false, error: "path-escape" }
  }
  return { ok: true, path: resolved }
}

const mimeForPackagedRendererAsset = (filePath) => {
  const ext = path.extname(String(filePath || "")).toLowerCase()
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8"
    case ".js":
      return "text/javascript; charset=utf-8"
    case ".css":
      return "text/css; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".svg":
      return "image/svg+xml"
    case ".png":
      return "image/png"
    case ".woff2":
      return "font/woff2"
    case ".wasm":
      return "application/wasm"
    default:
      return "application/octet-stream"
  }
}

const copyProxiedRequestHeaders = (request) => {
  const headers = new Headers()
  const source = request?.headers
  if (!source) return headers
  const skip = new Set(["host", "connection", "content-length"])
  if (typeof source.forEach === "function") {
    source.forEach((value, key) => {
      if (skip.has(String(key).toLowerCase())) return
      headers.set(key, value)
    })
    return headers
  }
  if (typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (skip.has(String(key).toLowerCase()) || typeof value !== "string") continue
      headers.set(key, value)
    }
  }
  return headers
}

const isSafeLoopbackApiOrigin = (origin) => {
  try {
    const parsed = new URL(String(origin || ""))
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    if (parsed.username || parsed.password) return false
    return isLoopbackDesktopHostname(parsed.hostname)
  } catch {
    return false
  }
}

const proxyPackagedRendererApiRequest = async (request, { getApiOrigin, fetchImpl }) => {
  const apiOrigin = typeof getApiOrigin === "function" ? String(getApiOrigin() || "").replace(/\/+$/, "") : ""
  if (!apiOrigin || !isSafeLoopbackApiOrigin(apiOrigin)) {
    return new Response("Service Unavailable", { status: 503 })
  }
  const source = new URL(request.url)
  const target = `${apiOrigin}${source.pathname}${source.search}`
  const init = {
    method: request.method || "GET",
    headers: copyProxiedRequestHeaders(request),
  }
  if (init.method !== "GET" && init.method !== "HEAD" && request.body != null) {
    init.body = request.body
    init.duplex = "half"
  }
  try {
    return await fetchImpl(target, init)
  } catch {
    return new Response("Bad Gateway", { status: 502 })
  }
}

const createPackagedRendererProtocolHandler = ({ webDistPath, readFile, getApiOrigin, fetchImpl }) => {
  const proxyFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch
  return async (request) => {
    if (!isPackagedRendererUrl(request?.url)) {
      return new Response("Not Found", { status: 404 })
    }
    let pathname = "/"
    try {
      pathname = new URL(request.url).pathname
    } catch {
      return new Response("Bad Request", { status: 400 })
    }
    if (isLoopbackApiPath(pathname)) {
      return proxyPackagedRendererApiRequest(request, { getApiOrigin, fetchImpl: proxyFetch })
    }
    const resolved = resolvePackagedRendererAssetPath(webDistPath, pathname)
    if (!resolved.ok) {
      return new Response("Forbidden", { status: 403 })
    }
    try {
      // Serve original bytes. Rewriting HTML to inject the API origin stopped
      // Chromium from executing Vite module scripts on app://.
      const body = await readFile(resolved.path)
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": mimeForPackagedRendererAsset(resolved.path),
          "Content-Security-Policy": buildPackagedRendererCsp(),
        },
      })
    } catch {
      return new Response("Not Found", { status: 404 })
    }
  }
}

module.exports = {
  PACKAGED_RENDERER_SCHEME,
  PACKAGED_RENDERER_HOST,
  PACKAGED_RENDERER_ORIGIN,
  PACKAGED_RENDERER_PRIVILEGED_SCHEMES,
  RENDERER_API_ORIGIN_ARG_PREFIX,
  LOOPBACK_API_PREFIXES,
  LOOPBACK_CONNECT_SRC,
  isPackagedRendererOrigin,
  isPackagedRendererUrl,
  isTrustedRendererNavigationUrl,
  isLoopbackApiPath,
  buildRendererApiOrigin,
  buildRendererApiOriginAdditionalArguments,
  readRendererApiOriginFromArgv,
  buildPackagedRendererCsp,
  parseCspDirective,
  isLoopbackConnectSrc,
  resolvePackagedRendererAssetPath,
  mimeForPackagedRendererAsset,
  createPackagedRendererProtocolHandler,
}
