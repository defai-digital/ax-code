import React from "react"
import type { Session } from "@ax-code/sdk/v2"
import { useSessionFoldersStore } from "@/stores/useSessionFoldersStore"
import { normalizePath } from "../utils"
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
  const { isSessionsLoading, sessions, cleanupSessions } = args

  React.useEffect(() => {
    if (isSessionsLoading) {
      return
    }

    const store = useSessionFoldersStore.getState()

    // The per-sub-directory archived auto-folders were retired — archived
    // sessions now render as a flat list. Purge any that were persisted so they
    // can't resurface as fake "projects" (e.g. `ax-code`) under Archived.
    Object.keys(store.foldersMap).forEach((scopeKey) => {
      if (!scopeKey.startsWith("__archived__:")) {
        return
      }
      for (const folder of store.foldersMap[scopeKey] ?? []) {
        store.deleteFolder(scopeKey, folder.id)
      }
    })

    // Maintain manual (directory-scoped) folders: drop sessions that no longer exist.
    const idsByDirectory = new Map<string, Set<string>>()
    sessions.forEach((session) => {
      const directory = normalizePath((session as Session & { directory?: string | null }).directory ?? null)
      if (!directory) {
        return
      }
      const existing = idsByDirectory.get(directory)
      if (existing) {
        existing.add(session.id)
        return
      }
      idsByDirectory.set(directory, new Set([session.id]))
    })

    Object.keys(store.foldersMap).forEach((scopeKey) => {
      if (scopeKey.startsWith("__archived__:")) {
        return
      }
      cleanupSessions(scopeKey, idsByDirectory.get(scopeKey) ?? new Set<string>())
    })
  }, [cleanupSessions, isSessionsLoading, sessions])
}
