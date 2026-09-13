import { createSessionTreeIndex } from "./session-tree"

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

// The route renders requests for itself and all loaded descendants, including
// when the viewed session is a child. Ancestors and siblings need a notice.
export function familySessionIDs(
  sessions: readonly { id: string; parentID?: string }[],
  currentSessionID: string | undefined,
): Set<string> {
  return createSessionTreeIndex(sessions).subtree(currentSessionID)
}

export function requestsInSessionTree<T extends PendingRequestRef>(
  requests: Record<string, T[] | undefined>,
  family: ReadonlySet<string>,
): T[] {
  return Object.values(requests)
    .flatMap((list) => list ?? [])
    .filter((request) => family.has(request.sessionID))
    .toSorted((a, b) => a.sessionID.localeCompare(b.sessionID) || a.id.localeCompare(b.id))
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
