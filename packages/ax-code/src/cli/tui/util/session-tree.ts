export type SessionTreeNode = { id: string; parentID?: string }

/** Index once for list consumers; traversal is iterative and safe for cycles. */
export function createSessionTreeIndex(sessions: readonly SessionTreeNode[]) {
  const children = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const siblings = children.get(session.parentID) ?? []
    siblings.push(session.id)
    children.set(session.parentID, siblings)
  }
  // The index is immutable after construction, so a subtree is computed once
  // per root. Callers receive a copy because some mutate the result (the
  // footer removes the parent from its descendants); sharing the cached Set
  // would silently corrupt later reads.
  const cache = new Map<string, Set<string>>()
  return {
    subtree(sessionID: string | undefined): Set<string> {
      if (sessionID === undefined) return new Set<string>()
      const cached = cache.get(sessionID)
      if (cached) return new Set(cached)
      const ids = new Set<string>()
      const pending = [sessionID]
      while (pending.length) {
        const id = pending.pop()!
        if (ids.has(id)) continue
        ids.add(id)
        pending.push(...(children.get(id) ?? []))
      }
      cache.set(sessionID, ids)
      return new Set(ids)
    },
  }
}
