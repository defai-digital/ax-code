import type { Session } from "@ax-code/sdk/v2"
import { isRecord } from "@/util/record"

function isRenderableSession(input: unknown): input is Session {
  return (
    isRecord(input) &&
    typeof input.id === "string" &&
    typeof input.title === "string" &&
    isRecord(input.time) &&
    typeof input.time.updated === "number"
  )
}

export function normalizeDialogSessions(data: unknown): Session[] {
  return Array.isArray(data) ? data.filter(isRenderableSession) : []
}

/** Prefer the live SDK workspace; sync.path can still hold the original cwd. */
export function localWorkspaceDirectory(sdkDirectory: string | undefined, pathDirectory: string | undefined) {
  return sdkDirectory ?? pathDirectory
}

export function orderRootSessions<T extends { id: string; parentID?: string; time: { updated: number } }>(
  sessions: readonly T[],
  pinned: readonly string[],
): T[] {
  const ids = new Set(sessions.map((session) => session.id))
  const roots = sessions
    .filter((session) => !session.parentID || !ids.has(session.parentID))
    .toSorted((a, b) => b.time.updated - a.time.updated)
  const byID = new Map(roots.map((session) => [session.id, session]))
  const pinIDs = new Set(pinned)
  return [
    ...[...pinIDs].flatMap((id) => {
      const session = byID.get(id)
      return session ? [session] : []
    }),
    ...roots.filter((session) => !pinIDs.has(session.id)),
  ]
}

export function sessionNavigationEntries<T extends { id: string; parentID?: string; time: { updated: number } }>(
  sessions: readonly T[],
  pinned: readonly string[],
  expanded: ReadonlySet<string> | "all",
) {
  const children = new Map<string, T[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const list = children.get(session.parentID) ?? []
    list.push(session)
    children.set(session.parentID, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.id.localeCompare(b.id))
  const rows: { session: T; depth: number; hasChildren: boolean }[] = []
  const seen = new Set<string>()
  const pending = orderRootSessions(sessions, pinned)
    .reverse()
    .map((session) => ({ session, depth: 0 }))
  while (pending.length) {
    const item = pending.pop()!
    if (seen.has(item.session.id)) continue
    seen.add(item.session.id)
    const descendants = children.get(item.session.id) ?? []
    rows.push({ ...item, hasChildren: descendants.length > 0 })
    if (expanded !== "all" && !expanded.has(item.session.id)) continue
    for (let index = descendants.length - 1; index >= 0; index--) {
      pending.push({ session: descendants[index], depth: item.depth + 1 })
    }
  }
  return rows
}

/** Short identities appear only when titles collide in the displayed list. */
export function duplicateSessionHints(sessions: readonly { id: string; title: string }[]) {
  const groups = new Map<string, Set<string>>()
  for (const session of sessions) {
    const key = session.title.trim().toLowerCase()
    const ids = groups.get(key) ?? new Set<string>()
    ids.add(session.id)
    groups.set(key, ids)
  }
  const result = new Map<string, string>()
  for (const group of groups.values()) {
    const ids = [...group]
    if (ids.length < 2) continue
    let length = 4
    const limit = Math.max(...ids.map((id) => id.length))
    while (length < limit && new Set(ids.map((id) => id.slice(-length))).size < ids.length) length++
    for (const id of ids) result.set(id, id.slice(-length))
  }
  return result
}
