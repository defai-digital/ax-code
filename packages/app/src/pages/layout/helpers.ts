import { getFilename } from "@ax-code/util/path"
import { type Session } from "@ax-code/sdk/v2/client"
import { type LocalProject } from "@/context/layout"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

type WorkspaceNames = {
  workspaceName: Record<string, string>
  workspaceBranchName: Record<string, Record<string, string>>
}

export const workspaceKey = (directory: string) => {
  const value = directory.replaceAll("\\", "/")
  const drive = value.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1]}/`
  if (/^\/+$/i.test(value)) return "/"
  return value.replace(/\/+$/, "")
}

function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

const isRootVisibleSession = (session: Session, directory: string) =>
  workspaceKey(session.directory) === workspaceKey(directory) && !session.parentID && !session.time?.archived

const roots = (store: SessionStore) =>
  (store.session ?? []).filter((session) => isRootVisibleSession(session, store.path.directory))

export const sortedRootSessions = (store: SessionStore, now: number) => roots(store).sort(sortSessions(now))

export const latestRootSession = (stores: SessionStore[], now: number) => {
  const cmp = sortSessions(now)
  let best: Session | undefined
  for (const store of stores) {
    for (const session of roots(store)) {
      if (!best || cmp(session, best) < 0) best = session
    }
  }
  return best
}

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const childMapByParent = (sessions: Session[] | undefined) => {
  const map = new Map<string, string[]>()
  for (const session of sessions ?? []) {
    if (!session.parentID) continue
    const existing = map.get(session.parentID)
    if (existing) {
      existing.push(session.id)
      continue
    }
    map.set(session.parentID, [session.id])
  }
  return map
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = workspaceKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = workspaceKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = workspaceKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}

export const getWorkspaceName = (store: WorkspaceNames, directory: string, projectId?: string, branch?: string) => {
  const key = workspaceKey(directory)
  const direct = store.workspaceName[key] ?? store.workspaceName[directory]
  if (direct) return direct
  if (!projectId || !branch) return
  return store.workspaceBranchName[projectId]?.[branch]
}

export const getWorkspaceLabel = (store: WorkspaceNames, directory: string, branch?: string, projectId?: string) =>
  getWorkspaceName(store, directory, projectId, branch) ?? branch ?? getFilename(directory)

export const workspaceIdsForProject = ({
  project,
  active,
  current,
  persisted,
  pending,
}: {
  project: LocalProject | undefined
  active?: string
  current?: string
  persisted?: string[]
  pending?: (directory: string) => boolean
}) => {
  if (!project) return []
  const local = project.worktree
  const dirs = [local, ...(project.sandboxes ?? [])]
  const extra =
    current &&
    workspaceKey(active ?? "") === workspaceKey(project.worktree) &&
    workspaceKey(current) !== workspaceKey(local) &&
    !dirs.some((item) => workspaceKey(item) === workspaceKey(current))
      ? current
      : undefined

  const ordered = effectiveWorkspaceOrder(local, dirs, persisted)
  if (!extra) return ordered
  if (!pending?.(extra)) return [...ordered, extra]
  return [local, extra, ...ordered.filter((item) => item !== local)]
}

export const mergeByID = <T extends { id: string }>(current: T[], incoming: T[]) => {
  if (current.length === 0) {
    return incoming.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  const map = new Map<string, T>()
  for (const item of current) {
    map.set(item.id, item)
  }
  for (const item of incoming) {
    map.set(item.id, item)
  }
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
