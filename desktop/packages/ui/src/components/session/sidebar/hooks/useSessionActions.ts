import React from "react"
import type { Session } from "@ax-code/sdk/v2"
import { toast } from "@/components/ui"
import { copyTextToClipboard } from "@/lib/clipboard"
import { useI18n } from "@/lib/i18n"
import { softArchiveSession, softDeleteSession, softBulkArchive, softBulkDelete } from "@/sync/soft-removal"

type DeleteSessionConfirmSetter = React.Dispatch<
  React.SetStateAction<{
    session: Session
    descendantCount: number
    descendantIds: string[]
    archivedBucket: boolean
  } | null>
>

type Args = {
  activeProjectId: string | null
  currentDirectory: string | null
  currentSessionId: string | null
  allowReselect: boolean
  onSessionSelected?: (sessionId: string) => void
  isSessionSearchOpen: boolean
  sessionSearchQuery: string
  setSessionSearchQuery: (value: string) => void
  setIsSessionSearchOpen: (open: boolean) => void
  setActiveProjectIdOnly: (id: string) => void
  setDirectory: (directory: string, options?: { showOverlay?: boolean }) => void
  setCurrentSession: (sessionId: string | null, directoryHint?: string | null) => void
  updateSessionTitle: (id: string, title: string) => Promise<void>
  shareSession: (id: string) => Promise<Session | null>
  unshareSession: (id: string) => Promise<Session | null>
  deleteSession: (id: string) => Promise<boolean>
  deleteSessions: (ids: string[]) => Promise<{ deletedIds: string[]; failedIds: string[] }>
  archiveSession: (id: string) => Promise<boolean>
  archiveSessions: (ids: string[]) => Promise<{ archivedIds: string[]; failedIds: string[] }>
  childrenMap: Map<string, Session[]>
  showDeletionDialog: boolean
  setDeleteSessionConfirm: DeleteSessionConfirmSetter
  deleteSessionConfirm: {
    session: Session
    descendantCount: number
    descendantIds: string[]
    archivedBucket: boolean
  } | null
  setEditingId: (id: string | null) => void
  setEditTitle: (value: string) => void
  editingId: string | null
  editTitle: string
}

export const useSessionActions = (args: Args) => {
  const { t } = useI18n()
  const [copiedSessionId, setCopiedSessionId] = React.useState<string | null>(null)
  const copyTimeout = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (copyTimeout.current) {
        clearTimeout(copyTimeout.current)
      }
    }
  }, [])

  const handleSessionSelect = React.useCallback(
    (sessionId: string, sessionDirectory?: string | null, disabled?: boolean, projectId?: string | null) => {
      if (disabled) {
        return
      }

      const resetSessionSearch = () => {
        if (!args.isSessionSearchOpen && args.sessionSearchQuery.length === 0) {
          return
        }
        args.setSessionSearchQuery("")
        args.setIsSessionSearchOpen(false)
      }

      if (projectId && projectId !== args.activeProjectId) {
        args.setActiveProjectIdOnly(projectId)
      }

      if (sessionDirectory && sessionDirectory !== args.currentDirectory) {
        args.setDirectory(sessionDirectory, { showOverlay: false })
      }

      if (sessionId === args.currentSessionId) {
        if (args.allowReselect) {
          args.onSessionSelected?.(sessionId)
        }
        resetSessionSearch()
        return
      }
      args.setCurrentSession(sessionId, sessionDirectory ?? null)
      args.onSessionSelected?.(sessionId)
      resetSessionSearch()
    },
    [args],
  )

  const handleSessionDoubleClick = React.useCallback(
    (sessionId: string, sessionTitle: string) => {
      args.setEditingId(sessionId)
      args.setEditTitle(sessionTitle)
    },
    [args],
  )

  const handleSaveEdit = React.useCallback(async () => {
    if (!args.editingId) return
    const trimmed = args.editTitle.trim()
    if (trimmed) {
      await args.updateSessionTitle(args.editingId, trimmed)
    }
    args.setEditingId(null)
    args.setEditTitle("")
  }, [args])

  const handleCancelEdit = React.useCallback(() => {
    args.setEditingId(null)
    args.setEditTitle("")
  }, [args])

  const handleShareSession = React.useCallback(
    async (session: Session) => {
      const result = await args.shareSession(session.id)
      if (result && result.share?.url) {
        toast.success(t("sessions.sidebar.session.share.successTitle"), {
          description: t("sessions.sidebar.session.share.successDescription"),
        })
      } else {
        toast.error(t("sessions.sidebar.session.share.error"))
      }
    },
    [args, t],
  )

  const handleCopyShareUrl = React.useCallback(
    (url: string, sessionId: string) => {
      void copyTextToClipboard(url)
        .then((result) => {
          if (!result.ok) {
            toast.error(t("sessions.sidebar.session.share.copyUrlError"))
            return
          }
          setCopiedSessionId(sessionId)
          if (copyTimeout.current) {
            clearTimeout(copyTimeout.current)
          }
          copyTimeout.current = window.setTimeout(() => {
            setCopiedSessionId(null)
            copyTimeout.current = null
          }, 2000)
        })
        .catch(() => {
          toast.error(t("sessions.sidebar.session.share.copyUrlError"))
        })
    },
    [t],
  )

  const handleUnshareSession = React.useCallback(
    async (sessionId: string) => {
      const result = await args.unshareSession(sessionId)
      if (result) {
        toast.success(t("sessions.sidebar.session.unshare.success"))
      } else {
        toast.error(t("sessions.sidebar.session.unshare.error"))
      }
    },
    [args, t],
  )

  const collectDescendants = React.useCallback(
    (sessionId: string): Session[] => {
      const collected: Session[] = []
      const visit = (id: string) => {
        const children = args.childrenMap.get(id) ?? []
        children.forEach((child) => {
          collected.push(child)
          visit(child.id)
        })
      }
      visit(sessionId)
      return collected
    },
    [args.childrenMap],
  )

  // Archive cascades to subagents that aren't already archived; hard-delete
  // cascades to every descendant unconditionally. We collect once and filter
  // per-action so the dialog count and the executed ID list always agree.
  const filterDescendantsForAction = React.useCallback(
    (descendants: Session[], shouldHardDelete: boolean): Session[] => {
      if (shouldHardDelete) return descendants
      return descendants.filter((s) => !s.time?.archived)
    },
    [],
  )

  const executeDeleteSession = React.useCallback(
    async (session: Session, source?: { archivedBucket?: boolean }, precomputed?: { descendantIds: string[] }) => {
      const shouldHardDelete = source?.archivedBucket === true
      const descendantIds =
        precomputed?.descendantIds ??
        filterDescendantsForAction(collectDescendants(session.id), shouldHardDelete).map((s) => s.id)

      if (descendantIds.length === 0) {
        if (shouldHardDelete) {
          softDeleteSession(session)
        } else {
          softArchiveSession(session)
        }
        return
      }

      const allSessions = [session]
      const descendants = collectDescendants(session.id).filter((s) => descendantIds.includes(s.id))
      allSessions.push(...descendants)

      if (shouldHardDelete) {
        softBulkDelete(allSessions)
      } else {
        softBulkArchive(allSessions)
      }
    },
    [collectDescendants, filterDescendantsForAction],
  )

  const handleDeleteSession = React.useCallback(
    (session: Session, source?: { archivedBucket?: boolean }) => {
      const shouldHardDelete = source?.archivedBucket === true
      const effectiveDescendantIds = filterDescendantsForAction(collectDescendants(session.id), shouldHardDelete).map(
        (s) => s.id,
      )
      if (!args.showDeletionDialog) {
        void executeDeleteSession(session, source, { descendantIds: effectiveDescendantIds })
        return
      }
      args.setDeleteSessionConfirm({
        session,
        descendantCount: effectiveDescendantIds.length,
        descendantIds: effectiveDescendantIds,
        archivedBucket: shouldHardDelete,
      })
    },
    [args, collectDescendants, executeDeleteSession, filterDescendantsForAction],
  )

  const confirmDeleteSession = React.useCallback(async () => {
    if (!args.deleteSessionConfirm) return
    const { session, archivedBucket, descendantIds } = args.deleteSessionConfirm
    args.setDeleteSessionConfirm(null)
    await executeDeleteSession(session, { archivedBucket }, { descendantIds })
  }, [args, executeDeleteSession])

  return {
    copiedSessionId,
    handleSessionSelect,
    handleSessionDoubleClick,
    handleSaveEdit,
    handleCancelEdit,
    handleShareSession,
    handleCopyShareUrl,
    handleUnshareSession,
    handleDeleteSession,
    confirmDeleteSession,
  }
}
