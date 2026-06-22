import React from "react"
import type { Session } from "@ax-code/sdk/v2"
import { useSessionFoldersStore } from "@/stores/useSessionFoldersStore"
import { dedupeSessionsById, getArchivedScopeKey, isSessionRelatedToProject, normalizePath } from "../utils"
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

    normalizedProjects.forEach((project) => {
      const scopeKey = getArchivedScopeKey(project.normalizedPath)
      const worktreesForProject = availableWorktreesByProject.get(project.normalizedPath) ?? []
      const validDirectories = new Set<string>([
        project.normalizedPath,
        ...worktreesForProject
          .map((meta) => normalizePath(meta.path) ?? meta.path)
          .filter((value): value is string => Boolean(value)),
      ])

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
          return isSessionRelatedToProject(session, project.normalizedPath, validDirectories)
        }),
      ]).filter((session) => isSessionRelatedToProject(session, project.normalizedPath, validDirectories))

      idsByScope.set(scopeKey, new Set(archivedForProject.map((session) => session.id)))
    })

    const currentFoldersMap = useSessionFoldersStore.getState().foldersMap
    const allScopeKeys = new Set([...Object.keys(currentFoldersMap), ...idsByScope.keys()])
    allScopeKeys.forEach((scopeKey) => {
      cleanupSessions(scopeKey, idsByScope.get(scopeKey) ?? new Set<string>())
    })
  }, [archivedSessions, availableWorktreesByProject, cleanupSessions, isSessionsLoading, normalizedProjects, sessions])
}
