type BreadcrumbSession = {
  id: string
  parentID?: string | null
  title?: string | null
}

export type SessionBreadcrumb =
  | {
      kind: "session"
      id: string
      label: string
      current: boolean
    }
  | {
      kind: "ellipsis"
      id: "ellipsis"
      label: "..."
      current: false
    }

function label(session: BreadcrumbSession) {
  const trimmed = session.title?.trim()
  if (trimmed) return trimmed
  return `Session ${session.id.slice(-6)}`
}

export function sessionBreadcrumbs(sessions: BreadcrumbSession[], currentID: string | undefined): SessionBreadcrumb[] {
  if (!currentID) return []
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const chain: SessionBreadcrumb[] = []
  const visited = new Set<string>()
  let current = byID.get(currentID)

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    chain.unshift({
      kind: "session",
      id: current.id,
      label: label(current),
      current: current.id === currentID,
    })
    current = current.parentID ? byID.get(current.parentID) : undefined
  }

  return chain
}

export function collapseSessionBreadcrumbs(
  items: SessionBreadcrumb[],
  input: {
    narrow: boolean
  },
): SessionBreadcrumb[] {
  if (!input.narrow) return items
  if (items.length <= 4) return items
  return [
    items[0],
    { kind: "ellipsis", id: "ellipsis", label: "...", current: false },
    items[items.length - 2],
    items[items.length - 1],
  ]
}
