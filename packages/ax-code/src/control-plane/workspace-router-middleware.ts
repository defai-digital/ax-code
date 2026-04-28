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

function sanitizeForwardedHeaders(input: Headers): Headers {
  const headers = new Headers()
  for (const [name, value] of input.entries()) {
    const lower = name.toLowerCase()
    if (lower === "authorization" || lower === "cookie") continue
    if (lower === "host" || lower === "connection" || lower === "content-length" || lower === "transfer-encoding") {
      continue
    }
    if (lower.startsWith("x-opencode-")) continue
    headers.set(name, value)
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

  const decodedPathname = decodeURIComponent(new URL(rawPath, WORKSPACE_PROXY_BASE_URL).pathname)

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
  })
}
