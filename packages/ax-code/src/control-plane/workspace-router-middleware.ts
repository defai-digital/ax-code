import type { MiddlewareHandler } from "hono"

import { Context } from "@/util/context"
import { Flag } from "@/flag/flag"
import { getAdaptor } from "./adaptors"
import { WorkspaceContext } from "./workspace-context"
import { Workspace } from "./workspace"
import type { WorkspaceID } from "./schema"

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
  return adaptor.fetch(row.extra, c.req.url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  })
}
