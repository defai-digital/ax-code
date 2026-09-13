import { createSessionActivityIndex, type ActivityStatuses, type RequestBuckets } from "../util/session-activity"
import { orderRootSessions } from "../component/session-list-data"

export type NavigationFilter = "recent" | "active"

export function navigationFilter(value: unknown): NavigationFilter {
  return value === "active" ? "active" : "recent"
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
