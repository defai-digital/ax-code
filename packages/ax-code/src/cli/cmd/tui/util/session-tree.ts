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
  return {
    subtree(sessionID: string | undefined): Set<string> {
      const ids = new Set<string>()
      if (sessionID === undefined) return ids
      const pending = [sessionID]
      while (pending.length) {
        const id = pending.pop()!
        if (ids.has(id)) continue
        ids.add(id)
        pending.push(...(children.get(id) ?? []))
      }
      return ids
    },
  }
}
