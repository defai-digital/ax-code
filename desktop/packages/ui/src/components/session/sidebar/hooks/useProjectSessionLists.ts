import React from "react"
import type { Session } from "@ax-code/sdk/v2"
import { dedupeSessionsById, normalizePath, resolveOwningProjectRoot } from "../utils"
import type { WorktreeMeta } from "../types"

type Args = {
  sessions: Session[]
  archivedSessions: Session[]
  availableWorktreesByProject: Map<string, WorktreeMeta[]>
  /** Every registered project root, so a session is assigned to only its most-specific owner. */
  allProjectRoots: string[]
}

export const useProjectSessionLists = (args: Args) => {
  const { sessions, archivedSessions, availableWorktreesByProject, allProjectRoots } = args

  const sessionsByDirectory = React.useMemo(() => {
    const next = new Map<string, Session[]>()
    sessions.forEach((session) => {
      const directory =
        normalizePath((session as Session & { directory?: string | null }).directory ?? null) ??
        normalizePath(
          (session as Session & { project?: { worktree?: string | null } | null }).project?.worktree ?? null,
        )
      if (!directory) {
        return
      }

      const collection = next.get(directory) ?? []
      collection.push(session)
      next.set(directory, collection)
    })
    return next
  }, [sessions])

  // Archived sections are built once per project. Resolve ownership once for
  // each session instead of scanning every project root for every section.
  const ownerProjectRootBySessionId = React.useMemo(() => {
    const owners = new Map<string, string | null>()
    for (const session of [...sessions, ...archivedSessions]) {
      owners.set(
        session.id,
        resolveOwningProjectRoot(session, allProjectRoots, availableWorktreesByProject),
      )
    }
    return owners
  }, [allProjectRoots, archivedSessions, availableWorktreesByProject, sessions])

  const getSessionsForProject = React.useCallback(
    (project: { normalizedPath: string }) => {
      const worktreesForProject = availableWorktreesByProject.get(project.normalizedPath) ?? []
      const directories = [
        project.normalizedPath,
        ...worktreesForProject
          .map((meta) => normalizePath(meta.path) ?? meta.path)
          .filter((value): value is string => Boolean(value)),
      ]

      const seen = new Set<string>()
      const collected: Session[] = []

      directories.forEach((directory) => {
        const sessionsForDirectory = sessionsByDirectory.get(directory) ?? []
        sessionsForDirectory.forEach((session) => {
          if (seen.has(session.id)) {
            return
          }
          seen.add(session.id)
          collected.push(session)
        })
      })

      return collected
    },
    [availableWorktreesByProject, sessionsByDirectory],
  )

  const getArchivedSessionsForProject = React.useCallback(
    (project: { normalizedPath: string }) => {
      const ownsSession = (session: Session): boolean =>
        ownerProjectRootBySessionId.get(session.id) === project.normalizedPath

      const archived = archivedSessions.filter(ownsSession)
      const unassignedLive = sessions.filter((session) => {
        if (session.time?.archived) {
          return false
        }
        const sessionDirectory = normalizePath((session as Session & { directory?: string | null }).directory ?? null)
        if (sessionDirectory) {
          return false
        }
        const projectWorktree = normalizePath(
          (session as Session & { project?: { worktree?: string | null } | null }).project?.worktree ?? null,
        )
        if (!projectWorktree) {
          return false
        }
        return ownsSession(session)
      })

      return dedupeSessionsById([...archived, ...unassignedLive])
    },
    [archivedSessions, ownerProjectRootBySessionId, sessions],
  )

  return {
    getSessionsForProject,
    getArchivedSessionsForProject,
  }
}
