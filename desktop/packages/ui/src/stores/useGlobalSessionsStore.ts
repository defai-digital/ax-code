import { create } from "zustand"
import type { Session } from "@ax-code/sdk/v2"
import { axCodeClient } from "@/lib/ax-code/client"
import { normalizeProjectPath } from "@/lib/projectResolution"
import { listGlobalSessionPages } from "@/stores/globalSessions"

type GlobalSessionsStatus = "idle" | "loading" | "ready" | "error"

type LoadResult = {
  activeSessions: Session[]
  archivedSessions: Session[]
}

export type PendingRemovalKind = "archive" | "delete"

export type PendingRemovalEntry = {
  session: Session
  kind: PendingRemovalKind
}

type GlobalSessionsState = {
  activeSessions: Session[]
  archivedSessions: Session[]
  sessionsByDirectory: Map<string, Session[]>
  pendingRemoval: Map<string, PendingRemovalEntry>
  /**
   * Bounded tombstone set for deletes (S4 review): `applySessionEvent`'s
   * delete plan records `id -> deletedAt` so a STALE reconnect snapshot
   * cannot resurrect a just-deleted session — `preserveNewerSessions` only
   * covers updates, because a deleted session has no current entry left to
   * compare freshness against. `applySnapshot` filters incoming sessions
   * with a live tombstone; entries expire after DELETE_TOMBSTONE_TTL_MS and
   * the map is pruned lazily (and capped at DELETE_TOMBSTONE_CAP) whenever a
   * new tombstone is recorded.
   */
  deleteTombstones: Map<string, number>
  hasLoaded: boolean
  status: GlobalSessionsStatus
  loadSessions: (fallbackActive?: Session[]) => Promise<LoadResult>
  applySnapshot: (activeSessions: Session[], archivedSessions: Session[], status?: GlobalSessionsStatus) => void
  /**
   * Apply a `session.created` / `session.updated` / `session.deleted` bus
   * event to the global index (SPEC-2026-08-30 S4.4). This is the reconcile
   * authority: the payload is shape-validated before any state is touched,
   * sessions inside their pendingRemoval undo window are never resurrected,
   * deletes record a bounded tombstone so stale snapshots cannot resurrect
   * the session either, and out-of-order events older than the current entry
   * are ignored so newer optimistic/local data is preserved. Archive
   * transitions arrive as `session.updated` with `time.archived` set.
   * Unrelated event types and malformed payloads are a no-op.
   */
  applySessionEvent: (payload: unknown) => void
  /**
   * Optimistic-transition primitive (SPEC-2026-08-30 S4.5). The session
   * lifecycle event stream is the sole writer of record for this store;
   * `upsertSession` exists only for (a) the event reducer itself
   * (`applySessionEvent`), (b) the create-time optimistic add in
   * `createSession`, and (c) rollback restores after failed soft-removals.
   * It is NOT a general mutation API — never call it to "maintain" the store
   * after an SDK mutation; rely on the session event instead.
   */
  upsertSession: (session: Session) => void
  /**
   * Optimistic-transition primitive (S4.5): used by `applySessionEvent` for
   * `session.deleted`, and by the hard-delete confirm flows in
   * `session-actions.ts` that bypass the `pendingRemoval` undo window.
   * Also funnels per-session client-state cleanup (message queue,
   * auto-accept toggles) for every delete path. Not a general mutation API.
   */
  removeSessions: (ids: Iterable<string>) => void
  /**
   * Optimistic-transition primitive (S4.5): used by the hard-archive confirm
   * flows in `session-actions.ts` that bypass the `pendingRemoval` undo
   * window. Event-fed archive transitions arrive as `session.updated` and go
   * through `upsertSession`, not here. Not a general mutation API.
   */
  archiveSessions: (ids: Iterable<string>, archivedAt?: number) => void
  markPendingRemoval: (entries: PendingRemovalEntry[]) => void
  undoPendingRemoval: (ids: Iterable<string>) => void
  commitPendingRemoval: (ids: Iterable<string>) => void
}

const PAGE_SIZE = 500

let inflightLoad: Promise<LoadResult> | null = null

export const resolveGlobalSessionDirectory = (session: Session): string | null => {
  const record = session as Session & {
    directory?: string | null
    project?: { worktree?: string | null } | null
  }

  return normalizeProjectPath(record.directory ?? null) ?? normalizeProjectPath(record.project?.worktree ?? null)
}

const buildSessionsByDirectory = (sessions: Session[]): Map<string, Session[]> => {
  const next = new Map<string, Session[]>()
  for (const session of sessions) {
    const directory = resolveGlobalSessionDirectory(session)
    if (!directory) {
      continue
    }
    const existing = next.get(directory)
    if (existing) {
      existing.push(session)
      continue
    }
    next.set(directory, [session])
  }
  return next
}

/**
 * Incremental Map update for a single session change (UI-06). Avoids
 * rebuilding the full directory index on every upsert/remove.
 */
const upsertSessionInDirectoryMap = (
  prev: Map<string, Session[]>,
  session: Session,
  previousDirectory: string | null | undefined,
): Map<string, Session[]> => {
  const nextDir = resolveGlobalSessionDirectory(session)
  if (previousDirectory === nextDir && nextDir) {
    const list = prev.get(nextDir)
    if (list) {
      const index = list.findIndex((item) => item.id === session.id)
      if (index >= 0 && getSessionSignature(list[index]!) === getSessionSignature(session)) {
        return prev
      }
    }
  }

  const next = new Map(prev)
  if (previousDirectory && previousDirectory !== nextDir) {
    const oldList = next.get(previousDirectory)
    if (oldList) {
      const filtered = oldList.filter((item) => item.id !== session.id)
      if (filtered.length === 0) next.delete(previousDirectory)
      else next.set(previousDirectory, filtered)
    }
  }
  if (!nextDir) {
    // Session has no directory — ensure it is not present under any key.
    if (previousDirectory) return next
    for (const [dir, list] of next) {
      if (list.some((item) => item.id === session.id)) {
        const filtered = list.filter((item) => item.id !== session.id)
        if (filtered.length === 0) next.delete(dir)
        else next.set(dir, filtered)
      }
    }
    return next
  }
  const existing = next.get(nextDir) ?? []
  const without = existing.filter((item) => item.id !== session.id)
  next.set(nextDir, [...without, session])
  return next
}

const removeSessionsFromDirectoryMap = (prev: Map<string, Session[]>, ids: Set<string>): Map<string, Session[]> => {
  if (ids.size === 0) return prev
  let changed = false
  const next = new Map<string, Session[]>()
  for (const [dir, list] of prev) {
    const filtered = list.filter((session) => !ids.has(session.id))
    if (filtered.length !== list.length) changed = true
    if (filtered.length > 0) next.set(dir, filtered)
    else if (list.length > 0) changed = true
  }
  return changed ? next : prev
}

const getSessionSignature = (session: Session): string => {
  return [
    session.id,
    session.title ?? "",
    session.time?.created ?? 0,
    session.time?.updated ?? 0,
    session.time?.archived ?? 0,
    session.share?.url ?? "",
    resolveGlobalSessionDirectory(session) ?? "",
  ].join(":")
}

const sameSessionList = (prev: Session[], next: Session[]): boolean => {
  if (prev === next) {
    return true
  }
  if (prev.length !== next.length) {
    return false
  }
  for (let index = 0; index < prev.length; index += 1) {
    if (getSessionSignature(prev[index]) !== getSessionSignature(next[index])) {
      return false
    }
  }
  return true
}

const getSessionFreshness = (session: Session): number => {
  return Math.max(session.time?.created ?? 0, session.time?.updated ?? 0, session.time?.archived ?? 0)
}

// ---------------------------------------------------------------------------
// Session lifecycle events (S4.4) — the event-fed path.
//
// `session.created` / `session.updated` / `session.deleted` are published to
// the global bus for every directory (core `Bus.publish*` emits to GlobalBus
// unconditionally), so the sync pipeline forwards them here for ALL
// directories — including ones without a per-directory child store. Archive
// transitions arrive as `session.updated` with `time.archived` set; there is
// no dedicated `session.archived` event.
// ---------------------------------------------------------------------------

const SESSION_LIFECYCLE_EVENT_TYPES = new Set(["session.created", "session.updated", "session.deleted"])

export const isSessionLifecycleEventType = (type: unknown): type is string =>
  typeof type === "string" && SESSION_LIFECYCLE_EVENT_TYPES.has(type)

/**
 * Shape-validate a session lifecycle event payload before it touches the
 * store. Events cross a process/network boundary, so only the fields the
 * reducer actually reads are required: a non-empty `info.id` and numeric
 * `time.created` / `time.updated` (`time.archived` numeric when present).
 */
const parseSessionLifecycleInfo = (payload: unknown): { type: string; info: Session } | null => {
  if (!payload || typeof payload !== "object") return null
  const record = payload as { type?: unknown; properties?: unknown }
  if (!isSessionLifecycleEventType(record.type)) return null
  const info =
    record.properties && typeof record.properties === "object"
      ? (record.properties as { info?: unknown }).info
      : undefined
  if (!info || typeof info !== "object") return null
  const candidate = info as Session
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return null
  const time = candidate.time as { created?: unknown; updated?: unknown; archived?: unknown } | undefined
  if (typeof time?.created !== "number" || typeof time?.updated !== "number") return null
  if (time.archived !== undefined && typeof time.archived !== "number") return null
  return { type: record.type, info: candidate }
}

/** What a session lifecycle event would do to the current state. */
export type SessionLifecyclePlan =
  | { kind: "invalid" }
  | { kind: "pending-removal"; session: Session }
  | { kind: "stale"; session: Session; current: Session }
  | { kind: "unchanged"; session: Session; current: Session }
  | { kind: "delete"; session: Session }
  | { kind: "upsert"; session: Session; current?: Session }

/**
 * Decide how a session lifecycle event applies to the given state, without
 * mutating anything. Shared by `applySessionEvent` (which executes the plan)
 * and the dev-mode dual-source diff logger (which describes it) so the two
 * can never drift apart.
 */
export const planSessionLifecycleEvent = (
  state: Pick<GlobalSessionsState, "activeSessions" | "archivedSessions" | "pendingRemoval">,
  payload: unknown,
): SessionLifecyclePlan => {
  const parsed = parseSessionLifecycleInfo(payload)
  if (!parsed) return { kind: "invalid" }
  const { type, info } = parsed

  // A session inside its soft-removal undo window must not be resurrected
  // (or otherwise mutated) by events — the window owns it until commit/undo.
  if (state.pendingRemoval.has(info.id)) return { kind: "pending-removal", session: info }

  if (type === "session.deleted") return { kind: "delete", session: info }

  const current =
    state.activeSessions.find((candidate) => candidate.id === info.id) ??
    state.archivedSessions.find((candidate) => candidate.id === info.id)
  // Out-of-order delivery: never overwrite a NEWER optimistic/local entry
  // with an older event (preserveNewerSessions semantics, per-session).
  if (current && getSessionFreshness(current) > getSessionFreshness(info)) {
    return { kind: "stale", session: info, current }
  }
  if (current && getSessionSignature(current) === getSessionSignature(info)) {
    return { kind: "unchanged", session: info, current }
  }
  return current ? { kind: "upsert", session: info, current } : { kind: "upsert", session: info }
}

const preserveNewerSessions = (incoming: Session[], current: Session[]): Session[] => {
  if (incoming.length === 0 || current.length === 0) {
    return incoming
  }

  const currentById = new Map(current.map((session) => [session.id, session]))
  let changed = false
  const next = incoming.map((session) => {
    const existing = currentById.get(session.id)
    if (!existing || getSessionFreshness(existing) <= getSessionFreshness(session)) {
      return session
    }
    changed = true
    return existing
  })

  return changed ? next : incoming
}

const upsertSessionIntoList = (sessions: Session[], session: Session): Session[] => {
  const index = sessions.findIndex((candidate) => candidate.id === session.id)
  if (index === -1) {
    return [session, ...sessions]
  }
  if (getSessionSignature(sessions[index]) === getSessionSignature(session)) {
    return sessions
  }
  const next = [...sessions]
  next[index] = session
  return next
}

const mergeSessionLists = (existing: Session[], incoming?: Session[]): Session[] => {
  if (!incoming || incoming.length === 0) {
    return existing
  }

  if (existing.length === 0) {
    return incoming
  }

  const byId = new Map(existing.map((session) => [session.id, session]))
  incoming.forEach((session) => {
    byId.set(session.id, session)
  })

  const ordered: Session[] = []
  const seen = new Set<string>()

  existing.forEach((session) => {
    const next = byId.get(session.id)
    if (!next) {
      return
    }
    ordered.push(next)
    seen.add(session.id)
  })

  incoming.forEach((session) => {
    if (seen.has(session.id)) {
      return
    }
    const next = byId.get(session.id)
    if (next) {
      ordered.push(next)
      seen.add(session.id)
    }
  })

  return ordered
}

const withoutPendingRemoval = (sessions: Session[], pendingRemoval: Map<string, PendingRemovalEntry>): Session[] => {
  if (pendingRemoval.size === 0) {
    return sessions
  }
  const filtered = sessions.filter((session) => !pendingRemoval.has(session.id))
  return filtered.length === sessions.length ? sessions : filtered
}

const DELETE_TOMBSTONE_TTL_MS = 15 * 60 * 1000
const DELETE_TOMBSTONE_CAP = 200

const isLiveTombstone = (deletedAt: number, now: number): boolean => now - deletedAt < DELETE_TOMBSTONE_TTL_MS

/**
 * Record a delete tombstone, lazily pruning expired entries and capping the
 * map oldest-first (Map preserves insertion order). Always returns a new map
 * so the state update is a real change.
 */
const recordDeleteTombstone = (tombstones: Map<string, number>, id: string, now: number): Map<string, number> => {
  const next = new Map<string, number>()
  for (const [entryId, deletedAt] of tombstones) {
    if (isLiveTombstone(deletedAt, now)) next.set(entryId, deletedAt)
  }
  next.delete(id) // refresh insertion order when the same id is re-deleted
  next.set(id, now)
  while (next.size > DELETE_TOMBSTONE_CAP) {
    const oldest = next.keys().next().value
    if (oldest === undefined) break
    next.delete(oldest)
  }
  return next
}

/**
 * Drop sessions with a LIVE delete tombstone from an incoming snapshot.
 * Keeps the original list reference when nothing matches, so referential
 * stability is preserved for the common no-tombstone case.
 */
const withoutDeleteTombstones = (sessions: Session[], tombstones: Map<string, number>): Session[] => {
  if (tombstones.size === 0) {
    return sessions
  }
  const now = Date.now()
  const filtered = sessions.filter((session) => {
    const deletedAt = tombstones.get(session.id)
    return deletedAt === undefined || !isLiveTombstone(deletedAt, now)
  })
  return filtered.length === sessions.length ? sessions : filtered
}

/**
 * Remove a session id from a list, keeping the original reference when the
 * id is not present — a no-op update must not produce a new array (same
 * length-check discipline as removeSessions).
 */
const removeSessionFromList = (sessions: Session[], id: string): Session[] => {
  if (!sessions.some((candidate) => candidate.id === id)) {
    return sessions
  }
  return sessions.filter((candidate) => candidate.id !== id)
}

const applySnapshot = (
  state: GlobalSessionsState,
  activeSessions: Session[],
  archivedSessions: Session[],
  status: GlobalSessionsStatus,
): Partial<GlobalSessionsState> | GlobalSessionsState => {
  // Snapshots from the server may still contain sessions the user just
  // soft-removed (pendingRemoval undo window) or hard-deleted (delete
  // tombstone — preserveNewerSessions cannot cover deletes because the
  // session has no current entry left); keep both out of the incoming lists.
  const incomingActive = withoutDeleteTombstones(
    withoutPendingRemoval(preserveNewerSessions(activeSessions, state.activeSessions), state.pendingRemoval),
    state.deleteTombstones,
  )
  const incomingArchived = withoutDeleteTombstones(
    withoutPendingRemoval(preserveNewerSessions(archivedSessions, state.archivedSessions), state.pendingRemoval),
    state.deleteTombstones,
  )
  const nextActiveSessions = sameSessionList(state.activeSessions, incomingActive)
    ? state.activeSessions
    : incomingActive
  const nextArchivedSessions = sameSessionList(state.archivedSessions, incomingArchived)
    ? state.archivedSessions
    : incomingArchived
  const nextSessionsByDirectory =
    nextActiveSessions === state.activeSessions
      ? state.sessionsByDirectory
      : buildSessionsByDirectory(nextActiveSessions)

  if (
    nextActiveSessions === state.activeSessions &&
    nextArchivedSessions === state.archivedSessions &&
    nextSessionsByDirectory === state.sessionsByDirectory &&
    state.hasLoaded &&
    state.status === status
  ) {
    return state
  }

  return {
    activeSessions: nextActiveSessions,
    archivedSessions: nextArchivedSessions,
    sessionsByDirectory: nextSessionsByDirectory,
    hasLoaded: true,
    status,
  }
}

export const useGlobalSessionsStore = create<GlobalSessionsState>((set, get) => ({
  activeSessions: [],
  archivedSessions: [],
  sessionsByDirectory: new Map(),
  pendingRemoval: new Map(),
  deleteTombstones: new Map(),
  hasLoaded: false,
  status: "idle",

  applySnapshot: (activeSessions, archivedSessions, status = "ready") => {
    set((state) => applySnapshot(state, activeSessions, archivedSessions, status))
  },

  applySessionEvent: (payload) => {
    const plan = planSessionLifecycleEvent(get(), payload)
    switch (plan.kind) {
      case "delete":
        // Record the tombstone BEFORE the removal so a stale reconnect
        // snapshot landing after the delete cannot resurrect the session.
        set((state) => ({
          deleteTombstones: recordDeleteTombstone(state.deleteTombstones, plan.session.id, Date.now()),
        }))
        get().removeSessions([plan.session.id])
        return
      case "upsert":
        get().upsertSession(plan.session)
        return
      default:
        // invalid / pending-removal / stale / unchanged — no state change
        return
    }
  },

  loadSessions: async (fallbackActive) => {
    if (inflightLoad) {
      return inflightLoad
    }

    set((state) => (state.status === "loading" ? state : { status: "loading" }))

    inflightLoad = (async () => {
      const current = get()

      try {
        const sdk = axCodeClient.getSdkClient()
        const [activeResult, archivedResult] = await Promise.allSettled([
          listGlobalSessionPages(sdk, { archived: false, pageSize: PAGE_SIZE }),
          listGlobalSessionPages(sdk, { archived: true, pageSize: PAGE_SIZE }),
        ])

        const fallbackSnapshot = mergeSessionLists(current.activeSessions, fallbackActive)
        const nextActiveSessions = activeResult.status === "fulfilled" ? activeResult.value : fallbackSnapshot
        const nextArchivedSessions =
          archivedResult.status === "fulfilled" ? archivedResult.value : current.archivedSessions

        if (activeResult.status === "rejected") {
          console.warn(
            "[GlobalSessions] Failed to load active sessions, preserving existing snapshot with fallback merge:",
            activeResult.reason,
          )
        }
        if (archivedResult.status === "rejected") {
          console.warn(
            "[GlobalSessions] Failed to load archived sessions, preserving current snapshot:",
            archivedResult.reason,
          )
        }

        set((state) => applySnapshot(state, nextActiveSessions, nextArchivedSessions, "ready"))
        return { activeSessions: nextActiveSessions, archivedSessions: nextArchivedSessions }
      } catch (error) {
        const nextActiveSessions = mergeSessionLists(current.activeSessions, fallbackActive)
        const nextArchivedSessions = current.archivedSessions
        console.warn("[GlobalSessions] Failed to load sessions, using fallback snapshot:", error)
        set((state) => applySnapshot(state, nextActiveSessions, nextArchivedSessions, "error"))
        return { activeSessions: nextActiveSessions, archivedSessions: nextArchivedSessions }
      } finally {
        inflightLoad = null
      }
    })()

    return inflightLoad
  },

  upsertSession: (session) => {
    set((state) => {
      // A session awaiting soft-removal commit must not be re-added by sync
      // events arriving during the undo window.
      if (state.pendingRemoval.has(session.id)) {
        return state
      }
      const isArchived = Boolean(session.time?.archived)
      const previous = state.activeSessions.find((candidate) => candidate.id === session.id)
      const previousDirectory = previous ? resolveGlobalSessionDirectory(previous) : undefined
      // The opposite-bucket removal goes through removeSessionFromList so a
      // session that is not present there keeps the list reference — an
      // unconditional filter would allocate a new array on every no-op
      // update and re-render every subscriber for nothing.
      const nextActiveSessions = isArchived
        ? removeSessionFromList(state.activeSessions, session.id)
        : upsertSessionIntoList(state.activeSessions, session)
      const nextArchivedSessions = isArchived
        ? upsertSessionIntoList(state.archivedSessions, session)
        : removeSessionFromList(state.archivedSessions, session.id)

      if (nextActiveSessions === state.activeSessions && nextArchivedSessions === state.archivedSessions) {
        return state
      }

      let sessionsByDirectory = state.sessionsByDirectory
      if (nextActiveSessions !== state.activeSessions) {
        if (isArchived) {
          sessionsByDirectory = removeSessionsFromDirectoryMap(state.sessionsByDirectory, new Set([session.id]))
        } else {
          sessionsByDirectory = upsertSessionInDirectoryMap(state.sessionsByDirectory, session, previousDirectory)
        }
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory,
      }
    })
  },

  removeSessions: (ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids)
    if (idSet.size === 0) {
      return
    }

    set((state) => {
      const nextActiveSessions = state.activeSessions.filter((session) => !idSet.has(session.id))
      const nextArchivedSessions = state.archivedSessions.filter((session) => !idSet.has(session.id))

      if (
        nextActiveSessions.length === state.activeSessions.length &&
        nextArchivedSessions.length === state.archivedSessions.length
      ) {
        return state
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory: removeSessionsFromDirectoryMap(state.sessionsByDirectory, idSet),
      }
    })

    // Every delete path funnels through here, so this is the one place to
    // drop persisted per-session client state (queued messages incl. base64
    // attachments, auto-accept toggles) — both maps otherwise grow forever
    // and the auto-accept one re-broadcasts a server POST per dead session
    // on every startup. Dynamic imports avoid a static cycle
    // (permissionStore → session-actions → this store). Deliberately not
    // done for archiveSessions: unarchive must restore a session intact.
    void Promise.all([import("@/stores/messageQueueStore"), import("@/stores/permissionStore")])
      .then(([queue, permission]) => {
        queue.useMessageQueueStore.getState().clearSessions(idSet)
        permission.usePermissionStore.getState().pruneAutoAccept(idSet)
      })
      .catch(() => {
        // best-effort cleanup — never let it break the removal itself
      })
  },

  archiveSessions: (ids, archivedAt = Date.now()) => {
    const idSet = ids instanceof Set ? ids : new Set(ids)
    if (idSet.size === 0) {
      return
    }

    set((state) => {
      const movedSessions: Session[] = []
      const nextActiveSessions = state.activeSessions.filter((session) => {
        if (!idSet.has(session.id)) {
          return true
        }

        movedSessions.push({
          ...session,
          time: {
            ...session.time,
            archived: archivedAt,
          },
        })
        return false
      })

      if (movedSessions.length === 0) {
        return state
      }

      const remainingArchivedSessions = state.archivedSessions.filter((session) => !idSet.has(session.id))

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: [...movedSessions, ...remainingArchivedSessions],
        sessionsByDirectory: removeSessionsFromDirectoryMap(state.sessionsByDirectory, idSet),
      }
    })
  },

  markPendingRemoval: (entries) => {
    if (entries.length === 0) return
    set((state) => {
      const nextPending = new Map(state.pendingRemoval)
      const ids = new Set<string>()
      for (const entry of entries) {
        nextPending.set(entry.session.id, entry)
        ids.add(entry.session.id)
      }
      const nextActiveSessions = state.activeSessions.filter((session) => !ids.has(session.id))
      const nextArchivedSessions = state.archivedSessions.filter((session) => !ids.has(session.id))
      return {
        pendingRemoval: nextPending,
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory:
          nextActiveSessions.length === state.activeSessions.length
            ? state.sessionsByDirectory
            : removeSessionsFromDirectoryMap(state.sessionsByDirectory, ids),
      }
    })
  },

  undoPendingRemoval: (ids) => {
    set((state) => {
      const nextPending = new Map(state.pendingRemoval)
      const restored: Session[] = []
      for (const id of ids) {
        const entry = nextPending.get(id)
        if (!entry) continue
        nextPending.delete(id)
        restored.push(entry.session)
      }
      if (restored.length === 0) {
        return state
      }
      let nextActiveSessions = state.activeSessions
      let nextArchivedSessions = state.archivedSessions
      let sessionsByDirectory = state.sessionsByDirectory
      for (const session of restored) {
        if (session.time?.archived) {
          nextArchivedSessions = upsertSessionIntoList(nextArchivedSessions, session)
        } else {
          nextActiveSessions = upsertSessionIntoList(nextActiveSessions, session)
          sessionsByDirectory = upsertSessionInDirectoryMap(sessionsByDirectory, session, undefined)
        }
      }
      return {
        pendingRemoval: nextPending,
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory,
      }
    })
  },

  commitPendingRemoval: (ids) => {
    set((state) => {
      const nextPending = new Map(state.pendingRemoval)
      let changed = false
      for (const id of ids) {
        if (nextPending.delete(id)) changed = true
      }
      return changed ? { pendingRemoval: nextPending } : state
    })
  },
}))

export const ensureGlobalSessionsLoaded = async (fallbackActive?: Session[]): Promise<LoadResult> => {
  const state = useGlobalSessionsStore.getState()
  if (state.hasLoaded && state.status !== "error") {
    return {
      activeSessions: state.activeSessions,
      archivedSessions: state.archivedSessions,
    }
  }
  return state.loadSessions(fallbackActive)
}

export const refreshGlobalSessions = async (fallbackActive?: Session[]): Promise<LoadResult> => {
  return useGlobalSessionsStore.getState().loadSessions(fallbackActive)
}
