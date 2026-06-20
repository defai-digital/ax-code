import type { MiddlewareHandler } from "hono"

import { Context } from "@/util/context"
import { Flag } from "@/flag/flag"
import { getAdaptor } from "./adaptors"
import { WorkspaceContext } from "./workspace-context"
import { Workspace } from "./workspace"
import type { WorkspaceID } from "./schema"
import { Log } from "@/util/log"

const log = Log.create({ service: "workspace-router-middleware" })
const WORKSPACE_PROXY_BASE_URL = "http://workspace.test"
const MAX_FORWARDED_HEADERS = 50
const MAX_FORWARDED_HEADER_BYTES = 8 * 1024
const MAX_FORWARDED_HEADERS_TOTAL_BYTES = 64 * 1024
const BLOCKED_FORWARDED_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-original-url",
  "x-real-ip",
  "x-rewrite-url",
])
const textEncoder = new TextEncoder()

function sanitizeForwardedHeaders(input: Headers): Headers {
  const headers = new Headers()
  let count = 0
  let totalBytes = 0
  for (const [name, value] of input.entries()) {
    const lower = name.toLowerCase()
    if (BLOCKED_FORWARDED_HEADERS.has(lower)) continue
    if (lower.startsWith("x-opencode-")) continue
    const bytes = textEncoder.encode(name).byteLength + textEncoder.encode(value).byteLength
    if (bytes > MAX_FORWARDED_HEADER_BYTES) continue
    if (count >= MAX_FORWARDED_HEADERS) continue
    if (totalBytes + bytes > MAX_FORWARDED_HEADERS_TOTAL_BYTES) continue
    headers.set(name, value)
    count++
    totalBytes += bytes
  }
  return headers
}

function normalizeWorkspacePath(rawPath: string): string {
  const rawPathLower = rawPath.toLowerCase()
  let decodedPath = rawPath
  try {
    decodedPath = decodeURIComponent(rawPath)
  } catch {
    // Keep the raw value if malformed percent-encoding appears.
  }

  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(new URL(rawPath, WORKSPACE_PROXY_BASE_URL).pathname)
  } catch {
    throw new Error(`Invalid workspace proxy path: ${rawPath}`)
  }

  if (
    rawPath.startsWith("//") ||
    decodedPath.startsWith("//") ||
    decodedPathname.startsWith("//") ||
    decodedPathname.includes("://") ||
    rawPathLower.includes("%3a%2f%2f") ||
    rawPathLower.includes("%2f%2f")
  ) {
    throw new Error(`Invalid workspace proxy path: ${rawPath}`)
  }

  const requestUrl = new URL(rawPath, WORKSPACE_PROXY_BASE_URL)
  // If a caller passes a full URL-like path (e.g. //host or https://...), this
  // check rejects it before it can reach the adaptor layer.
  if (requestUrl.origin !== WORKSPACE_PROXY_BASE_URL) {
    throw new Error(`Invalid workspace proxy path: ${rawPath}`)
  }

  return `${requestUrl.pathname}${requestUrl.search}`
}

export const WorkspaceRouterMiddleware: MiddlewareHandler = async (c, next) => {
  if (!Flag.AX_CODE_EXPERIMENTAL_WORKSPACES) return next()
  if (c.req.method === "GET") return next()
  if (!c.req.path.startsWith("/session/")) return next()

  let workspaceID: string
  try {
    workspaceID = WorkspaceContext.use().workspaceID
  } catch (error) {
    if (error instanceof Context.NotFound) return next()
    throw error
  }

  const row = Workspace.get(workspaceID as WorkspaceID)
  if (!row || row.type === "worktree") return next()

  const adaptor = getAdaptor(row.type)
  if (!adaptor) return next()
  const requestUrl = new URL(c.req.url)

  let requestPath: string
  try {
    requestPath = normalizeWorkspacePath(`${requestUrl.pathname}${requestUrl.search}`)
  } catch (error) {
    log.warn("invalid workspace session path", { path: requestUrl.pathname, workspaceID })
    return c.json({ error: error instanceof Error ? error.message : "Invalid workspace path" }, 400)
  }

  return adaptor.fetch(row.extra, requestPath, {
    method: c.req.method,
    headers: sanitizeForwardedHeaders(c.req.raw.headers),
    body: c.req.raw.body,
    // Node's fetch requires `duplex: "half"` when the body is a stream (Bun did
    // not); forwarding c.req.raw.body without it throws RequestInit TypeError.
    duplex: "half",
  } as RequestInit)
}
