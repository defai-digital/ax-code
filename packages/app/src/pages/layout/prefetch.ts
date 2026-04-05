import { type Session } from "@ax-code/sdk/v2/client"
import { pickSessionCacheEvictions } from "@/context/global-sync/session-cache"

import { workspaceKey } from "./helpers"

export type PrefetchQueue = {
  inflight: Set<string>
  pending: string[]
  pendingSet: Set<string>
  running: number
}

export type PrefetchPriority = "high" | "low"

export const prefetchChunk = 200
export const prefetchConcurrency = 2
export const prefetchPendingLimit = 10
export const prefetchSpan = 4
export const prefetchLimit = 10

export const lruFor = (dirs: Map<string, Set<string>>, directory: string) => {
  const existing = dirs.get(directory)
  if (existing) return existing
  const created = new Set<string>()
  dirs.set(directory, created)
  return created
}

export const markPrefetched = (input: {
  dirs: Map<string, Set<string>>
  directory: string
  sessionID: string
  limit: number
  active?: string
  current?: string
}) =>
  pickSessionCacheEvictions({
    seen: lruFor(input.dirs, input.directory),
    keep: input.sessionID,
    limit: input.limit,
    preserve:
      input.active && input.current && workspaceKey(input.directory) === workspaceKey(input.current)
        ? [input.active]
        : undefined,
  })

export const queueFor = (queues: Map<string, PrefetchQueue>, directory: string) => {
  const existing = queues.get(directory)
  if (existing) return existing

  const created: PrefetchQueue = {
    inflight: new Set(),
    pending: [],
    pendingSet: new Set(),
    running: 0,
  }
  queues.set(directory, created)
  return created
}

export const trimPrefetchedDirs = (dirs: Map<string, Set<string>>, visible: Iterable<string>) => {
  const keep = new Set(visible)
  for (const directory of [...dirs.keys()]) {
    if (keep.has(directory)) continue
    dirs.delete(directory)
  }
}

export const trimPrefetchQueues = (queues: Map<string, PrefetchQueue>, visible: Iterable<string>) => {
  const keep = new Set(visible)
  for (const [directory, q] of queues) {
    if (keep.has(directory)) continue
    q.pending.length = 0
    q.pendingSet.clear()
    if (q.running === 0) queues.delete(directory)
  }
}

export const queuePrefetch = (input: {
  q: PrefetchQueue
  lru: Set<string>
  sessionID: string
  priority: PrefetchPriority
  limit: number
  pendingLimit: number
}) => {
  if (input.q.inflight.has(input.sessionID)) return false
  if (input.q.pendingSet.has(input.sessionID)) {
    if (input.priority !== "high") return false
    const index = input.q.pending.indexOf(input.sessionID)
    if (index > 0) {
      input.q.pending.splice(index, 1)
      input.q.pending.unshift(input.sessionID)
    }
    return false
  }

  if (!input.lru.has(input.sessionID) && input.lru.size >= input.limit && input.priority !== "high") return false

  if (input.priority === "high") input.q.pending.unshift(input.sessionID)
  if (input.priority !== "high") input.q.pending.push(input.sessionID)
  input.q.pendingSet.add(input.sessionID)

  while (input.q.pending.length > input.pendingLimit) {
    const dropped = input.q.pending.pop()
    if (!dropped) continue
    input.q.pendingSet.delete(dropped)
  }

  return true
}

export const warmSessions = <T extends Pick<Session, "id" | "directory">>(
  sessions: T[],
  index: number,
  span: number,
  prefetch: (session: T, priority: PrefetchPriority) => void,
) => {
  for (let offset = 1; offset <= span; offset++) {
    const next = sessions[index + offset]
    if (next) prefetch(next, offset === 1 ? "high" : "low")

    const prev = sessions[index - offset]
    if (prev) prefetch(prev, offset === 1 ? "high" : "low")
  }
}
