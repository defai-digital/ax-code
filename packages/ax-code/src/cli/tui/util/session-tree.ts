export type SessionTreeNode = { id: string; parentID?: string }

/** Index once for list consumers; traversal is iterative and safe for cycles. */
export function createSessionTreeIndex(sessions: readonly SessionTreeNode[]) {
  const children = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const siblings = children.get(session.parentID) ?? []
    siblings.push(session.id)
    // Local index has at most one parent entry per input node and follows its session list.
    children.set(session.parentID, siblings) // @scan-suppress lifecycle_scan
  }
  // The index is immutable after construction, so retained subtrees can be
  // reused. Callers receive a copy because some mutate the result (the
  // footer removes the parent from its descendants); sharing the cached Set
  // would silently corrupt later reads.
  const cache = new Map<string, Set<string>>()
  let cachedNodes = 0
  const maxEntries = 64
  const maxNodes = 16_384
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
      // Do not retain quadratic descendant sets across many roots. Very large
      // subtrees remain queryable without being kept in the cache.
      if (ids.size > maxNodes) return ids
      while (cache.size >= maxEntries || cachedNodes + ids.size > maxNodes) {
        const oldest = cache.keys().next().value!
        cachedNodes -= cache.get(oldest)!.size
        cache.delete(oldest)
      }
      // @scan-suppress lifecycle_scan - FIFO eviction above caps both entries and retained node references.
      cache.set(sessionID, ids)
      cachedNodes += ids.size
      return new Set(ids)
    },
  }
}
