export type SessionTreeNode = { id: string; parentID?: string }
export type SessionTreeIndex = ReturnType<typeof createSessionTreeIndex>

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
  const compute = (sessionID: string): ReadonlySet<string> => {
    const cached = cache.get(sessionID)
    if (cached) return cached
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
    return ids
  }
  return {
    subtree(sessionID: string | undefined): Set<string> {
      if (sessionID === undefined) return new Set<string>()
      return new Set(compute(sessionID))
    },
    /** Read-only iteration over the same ids as subtree(), without the per-call copy. */
    each(sessionID: string | undefined, visit: (id: string) => void): void {
      if (sessionID === undefined) return
      for (const id of compute(sessionID)) visit(id)
    },
    /** O(1) "has at least one loaded child" probe from the children map. */
    hasChildren(sessionID: string): boolean {
      return (children.get(sessionID)?.length ?? 0) > 0
    },
  }
}
