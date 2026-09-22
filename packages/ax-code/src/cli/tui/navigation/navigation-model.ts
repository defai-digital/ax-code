import { createSessionActivityIndex, type ActivityStatuses, type RequestBuckets, type AttentionRequest } from "../util/session-activity"
import { orderRootSessions } from "../component/session-list-data"

export type NavigationFilter = "recent" | "active"

export function navigationFilter(value: unknown): NavigationFilter {
  return value === "recent" ? "recent" : "active"
}

/** Rail-only recents cutoff. Zero means the bar has not been cleared. */
export function navigationClearedAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

export const NAVIGATION_CLEAR_TITLE = "Clear navigation history"
export const NAVIGATION_CLEAR_MESSAGE =
  "This will clear the navigation bar history. Sessions are not deleted and remain available in /sessions. Are you sure?"

/** Ask before hiding historical rows from the rail. Cancel leaves the list unchanged. */
export async function confirmNavigationClear(input: {
  ask: () => Promise<boolean | undefined>
  apply: (at: number) => void
  now?: number
}) {
  const ok = await input.ask()
  if (!ok) return false
  input.apply(input.now ?? Date.now())
  return true
}

function addAncestorsAndDescendants<T extends { id: string; parentID?: string }>(
  sessions: readonly T[],
  keep: Set<string>,
  seed: string,
) {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  if (!byID.has(seed)) {
    keep.add(seed)
    return
  }
  const children = new Map<string, T[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const list = children.get(session.parentID) ?? []
    list.push(session)
    children.set(session.parentID, list)
  }
  const seen = new Set<string>()
  let current = byID.get(seed)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    keep.add(current.id)
    current = current.parentID ? byID.get(current.parentID) : undefined
  }
  const pending = [seed]
  while (pending.length) {
    const id = pending.pop()!
    keep.add(id)
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      pending.push(child.id)
    }
  }
}

export function projectLabel(directory: string | undefined) {
  if (!directory) return "Workspace unavailable"
  const trimmed = directory.replace(/[\\/]+$/, "")
  return trimmed.split(/[\\/]/).at(-1) || directory
}

/** Active is an observed-work filter; retain the current tree for orientation. */
export function activeNavigationSessions<
  T extends { id: string; parentID?: string; time: { updated: number } },
>(input: {
  sessions: readonly T[]
  statuses: ActivityStatuses
  permissions: RequestBuckets
  questions: RequestBuckets
  requests?: readonly AttentionRequest[]
  currentID?: string
  observed: boolean
}) {
  if (!input.observed) return [...input.sessions]
  const activity = createSessionActivityIndex(input)
  const included = new Set<string>()
  for (const root of orderRootSessions(input.sessions, [])) {
    const state = activity.get(root.id)
    if (!state.attention && !state.working && !state.members.some((member) => member.id === input.currentID)) continue
    for (const member of state.members) included.add(member.id)
  }
  return input.sessions.filter((session) => included.has(session.id))
}

/**
 * Hide historical rows from the navigation rail without deleting sessions.
 * `/sessions` ignores this cutoff. Current, pinned, and observed active trees stay.
 */
export function visibleAfterNavigationClear<
  T extends { id: string; parentID?: string; time: { updated: number } },
>(input: {
  sessions: readonly T[]
  clearedAt: unknown
  currentID?: string
  pinned?: readonly string[]
  statuses?: ActivityStatuses
  permissions?: RequestBuckets
  questions?: RequestBuckets
  requests?: readonly AttentionRequest[]
  observed?: boolean
}) {
  const clearedAt = navigationClearedAt(input.clearedAt)
  if (!clearedAt) return [...input.sessions]
  const keep = new Set<string>()
  for (const session of input.sessions) {
    if (session.time.updated > clearedAt) keep.add(session.id)
  }
  for (const id of input.pinned ?? []) addAncestorsAndDescendants(input.sessions, keep, id)
  if (input.currentID) addAncestorsAndDescendants(input.sessions, keep, input.currentID)
  if (input.observed) {
    for (const session of activeNavigationSessions({
      sessions: input.sessions,
      statuses: input.statuses ?? {},
      permissions: input.permissions ?? {},
      questions: input.questions ?? {},
      requests: input.requests,
      currentID: input.currentID,
      observed: true,
    })) {
      keep.add(session.id)
    }
  }
  for (const id of [...keep]) addAncestorsAndDescendants(input.sessions, keep, id)
  return input.sessions.filter((session) => keep.has(session.id))
}

/** Reveal the current path without changing the user's saved expansion set. */
export function navigationExpandedAncestors<T extends { id: string; parentID?: string }>(
  sessions: readonly T[],
  currentID: string | undefined,
  expanded: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = new Set(expanded)
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const seen = new Set<string>()
  let node = currentID ? byID.get(currentID) : undefined
  while (node?.parentID && !seen.has(node.id)) {
    seen.add(node.id)
    const parent = byID.get(node.parentID)
    if (!parent) break
    next.add(parent.id)
    node = parent
  }
  return next
}
