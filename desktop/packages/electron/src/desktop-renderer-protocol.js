"use strict"

const path = require("path")
const { isLoopbackDesktopHostname } = require("./desktop-hosts")
const { isTrustedRendererNavigationUrl: isTrustedLoopbackRendererNavigationUrl } = require("./renderer-navigation-policy")

const PACKAGED_RENDERER_SCHEME = "app"
const PACKAGED_RENDERER_HOST = "ax-code"
const PACKAGED_RENDERER_ORIGIN = `${PACKAGED_RENDERER_SCHEME}://${PACKAGED_RENDERER_HOST}`

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

const createPackagedRendererProtocolHandler = ({ webDistPath, readFile }) => {
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
    const resolved = resolvePackagedRendererAssetPath(webDistPath, pathname)
    if (!resolved.ok) {
      return new Response("Forbidden", { status: 403 })
    }
    try {
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
  LOOPBACK_CONNECT_SRC,
  isPackagedRendererOrigin,
  isPackagedRendererUrl,
  isTrustedRendererNavigationUrl,
  buildPackagedRendererCsp,
  parseCspDirective,
  isLoopbackConnectSrc,
  resolvePackagedRendererAssetPath,
  mimeForPackagedRendererAsset,
  createPackagedRendererProtocolHandler,
}
