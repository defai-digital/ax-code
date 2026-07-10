import React from "react"
import type { Session } from "@ax-code/sdk/v2"
import { useSessionFoldersStore } from "@/stores/useSessionFoldersStore"
import { dedupeSessionsById, getArchivedScopeKey, isSessionOwnedByProject, normalizePath } from "../utils"
import type { WorktreeMeta } from "../types"

type NormalizedProject = {
  id: string
  normalizedPath: string
}

type Args = {
  isSessionsLoading: boolean
  sessions: Session[]
  archivedSessions: Session[]
  normalizedProjects: NormalizedProject[]
  availableWorktreesByProject: Map<string, WorktreeMeta[]>
  cleanupSessions: (scopeKey: string, validSessionIds: Set<string>) => void
}

export const useSessionFolderCleanup = (args: Args): void => {
  const {
    isSessionsLoading,
    sessions,
    archivedSessions,
    normalizedProjects,
    availableWorktreesByProject,
    cleanupSessions,
  } = args

  React.useEffect(() => {
    if (isSessionsLoading) {
      return
    }

    const idsByScope = new Map<string, Set<string>>()
    sessions.forEach((session) => {
      const directory = normalizePath((session as Session & { directory?: string | null }).directory ?? null)
      if (!directory) {
        return
      }
      const existing = idsByScope.get(directory)
      if (existing) {
        existing.add(session.id)
        return
      }
      idsByScope.set(directory, new Set([session.id]))
    })

    const allProjectRoots = normalizedProjects.map((project) => project.normalizedPath)
    normalizedProjects.forEach((project) => {
      const scopeKey = getArchivedScopeKey(project.normalizedPath)
      const ownsSession = (session: Session): boolean =>
        isSessionOwnedByProject(session, project.normalizedPath, allProjectRoots, availableWorktreesByProject)

      const archivedForProject = dedupeSessionsById([
        ...archivedSessions,
        ...sessions.filter((session) => {
          if (session.time?.archived) {
            return false
          }
          const sessionDirectory = normalizePath((session as Session & { directory?: string | null }).directory ?? null)
          if (sessionDirectory) {
            return false
          }
          return ownsSession(session)
        }),
      ]).filter(ownsSession)

      idsByScope.set(scopeKey, new Set(archivedForProject.map((session) => session.id)))
    })

    const currentFoldersMap = useSessionFoldersStore.getState().foldersMap
    const allScopeKeys = new Set([...Object.keys(currentFoldersMap), ...idsByScope.keys()])
    allScopeKeys.forEach((scopeKey) => {
      cleanupSessions(scopeKey, idsByScope.get(scopeKey) ?? new Set<string>())
    })
  }, [archivedSessions, availableWorktreesByProject, cleanupSessions, isSessionsLoading, normalizedProjects, sessions])
}
