import { create } from "zustand"
import type { Session } from "@ax-code/sdk/v2"
import { axCodeClient } from "@/lib/ax-code/client"
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
  hasLoaded: boolean
  status: GlobalSessionsStatus
  loadSessions: (fallbackActive?: Session[]) => Promise<LoadResult>
  applySnapshot: (activeSessions: Session[], archivedSessions: Session[], status?: GlobalSessionsStatus) => void
  upsertSession: (session: Session) => void
  removeSessions: (ids: Iterable<string>) => void
  archiveSessions: (ids: Iterable<string>, archivedAt?: number) => void
  markPendingRemoval: (entries: PendingRemovalEntry[]) => void
  undoPendingRemoval: (ids: Iterable<string>) => void
  commitPendingRemoval: (ids: Iterable<string>) => void
}

const PAGE_SIZE = 500

let inflightLoad: Promise<LoadResult> | null = null

const normalizePath = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const replaced = trimmed.replace(/\\/g, "/")
  if (replaced === "/") {
    return "/"
  }
  return replaced.length > 1 ? replaced.replace(/\/+$/, "") : replaced
}

export const resolveGlobalSessionDirectory = (session: Session): string | null => {
  const record = session as Session & {
    directory?: string | null
    project?: { worktree?: string | null } | null
  }

  return normalizePath(record.directory ?? null) ?? normalizePath(record.project?.worktree ?? null)
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

const applySnapshot = (
  state: GlobalSessionsState,
  activeSessions: Session[],
  archivedSessions: Session[],
  status: GlobalSessionsStatus,
): Partial<GlobalSessionsState> | GlobalSessionsState => {
  // Snapshots from the server may still contain sessions the user just
  // soft-removed; keep them hidden until the removal commits or is undone.
  const incomingActive = withoutPendingRemoval(
    preserveNewerSessions(activeSessions, state.activeSessions),
    state.pendingRemoval,
  )
  const incomingArchived = withoutPendingRemoval(
    preserveNewerSessions(archivedSessions, state.archivedSessions),
    state.pendingRemoval,
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
  hasLoaded: false,
  status: "idle",

  applySnapshot: (activeSessions, archivedSessions, status = "ready") => {
    set((state) => applySnapshot(state, activeSessions, archivedSessions, status))
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
      const nextActiveSessions = isArchived
        ? state.activeSessions.filter((candidate) => candidate.id !== session.id)
        : upsertSessionIntoList(state.activeSessions, session)
      const nextArchivedSessions = isArchived
        ? upsertSessionIntoList(state.archivedSessions, session)
        : state.archivedSessions.filter((candidate) => candidate.id !== session.id)

      if (nextActiveSessions === state.activeSessions && nextArchivedSessions === state.archivedSessions) {
        return state
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory:
          nextActiveSessions === state.activeSessions
            ? state.sessionsByDirectory
            : buildSessionsByDirectory(nextActiveSessions),
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
        sessionsByDirectory: buildSessionsByDirectory(nextActiveSessions),
      }
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
        sessionsByDirectory: buildSessionsByDirectory(nextActiveSessions),
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
            : buildSessionsByDirectory(nextActiveSessions),
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
      for (const session of restored) {
        if (session.time?.archived) {
          nextArchivedSessions = upsertSessionIntoList(nextArchivedSessions, session)
        } else {
          nextActiveSessions = upsertSessionIntoList(nextActiveSessions, session)
        }
      }
      return {
        pendingRemoval: nextPending,
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
        sessionsByDirectory:
          nextActiveSessions === state.activeSessions
            ? state.sessionsByDirectory
            : buildSessionsByDirectory(nextActiveSessions),
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
