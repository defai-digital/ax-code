// Surfaces permission/question requests that the current route cannot answer
// (PRD-2026-09-12). The session route renders prompts only for the open
// session's family, so a request raised by a top-level automation session
// (scheduled task, detached queue work) would otherwise park invisibly until
// the run times out. The tracker hands out each outside-family request exactly
// once; the caller turns it into a toast naming the session.

export type PendingRequestRef = {
  id: string
  sessionID: string
}

// Mirrors the session route's family: the open session itself plus its child
// sessions (or, for a child, its siblings and parent). Requests from these
// sessions are answerable in place and need no global notice.
export function familySessionIDs(
  sessions: readonly { id: string; parentID?: string }[],
  currentSessionID: string | undefined,
): Set<string> {
  if (currentSessionID === undefined) return new Set()
  const current = sessions.find((session) => session.id === currentSessionID)
  if (!current) return new Set([currentSessionID])
  const parentID = current.parentID ?? current.id
  const family = new Set<string>([parentID])
  for (const session of sessions) {
    if (session.parentID === parentID) family.add(session.id)
  }
  return family
}

export function outsideFamilyRequests(
  requests: Record<string, PendingRequestRef[] | undefined>,
  family: ReadonlySet<string>,
): PendingRequestRef[] {
  const out: PendingRequestRef[] = []
  for (const list of Object.values(requests)) {
    for (const request of list ?? []) {
      if (!family.has(request.sessionID)) out.push(request)
    }
  }
  return out
}

// Fire-once tracking across reactive effect re-runs: each call returns only
// the outside-family requests not seen before. Seen ids that are no longer
// pending are pruned so a re-asked request (same id re-used) would notify
// again and the set cannot grow unboundedly.
export function createPendingRequestTracker() {
  const seen = new Set<string>()

  function update<T extends PendingRequestRef>(requests: readonly T[]): T[] {
    const pending = new Set(requests.map((request) => request.id))
    for (const id of seen) {
      if (!pending.has(id)) seen.delete(id)
    }
    const fresh = requests.filter((request) => !seen.has(request.id))
    for (const request of fresh) seen.add(request.id)
    return fresh
  }

  return { update }
}
