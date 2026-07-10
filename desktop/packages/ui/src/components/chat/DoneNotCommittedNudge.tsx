import React from "react"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useGitStore, useIsGitRepo } from "@/stores/useGitStore"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { useGlobalSessionStatus, useSessionPermissions } from "@/sync/sync-context"
import { useRunStateStore, useSessionRunEndedAt, useNudgeDismissedAt } from "@/sync/run-state-store"
import { useUIStore } from "@/stores/useUIStore"
import { Icon } from "@/components/icon/Icon"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"

export const DoneNotCommittedNudge: React.FC = React.memo(() => {
  const { t } = useI18n()
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId)
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)
  const sessionStatus = useGlobalSessionStatus(currentSessionId ?? "")
  const permissions = useSessionPermissions(currentSessionId ?? "")
  const isGitRepo = useIsGitRepo(currentDirectory)
  const gitStatus = useGitStore((s) =>
    currentDirectory ? (s.directories.get(currentDirectory)?.status ?? null) : null,
  )
  const setRightSidebarOpen = useUIStore((s) => s.setRightSidebarOpen)
  const setRightSidebarTab = useUIStore((s) => s.setRightSidebarTab)
  const runEndedAt = useSessionRunEndedAt(currentSessionId ?? "")
  const dismissedAt = useNudgeDismissedAt(currentSessionId ?? "")
  const dismissNudge = useRunStateStore((s) => s.dismissNudge)

  const isIdle = (sessionStatus?.type ?? "idle") === "idle" && permissions.length === 0
  const isDirty = isGitRepo === true && gitStatus !== null && !gitStatus.isClean
  const fileCount = gitStatus?.files?.length ?? 0

  // Only nudge after an observed run-ended transition for this session
  // (recorded in run-state-store), never for pre-existing dirty state, and
  // stay dismissed until the next run ends.
  const visible =
    Boolean(currentSessionId) &&
    runEndedAt !== null &&
    isIdle &&
    isDirty &&
    fileCount > 0 &&
    (dismissedAt === null || dismissedAt < runEndedAt)

  if (!visible || !currentSessionId) return null

  // The main content area is locked to chat/plan — Header resets any other
  // activeMainTab back to "chat" — so git/diff moved into the right sidebar.
  // Both actions open the git panel, which shows the changed-file diffs (review)
  // and the commit UI (commit). Previously these set activeMainTab and did nothing.
  const openGitPanel = () => {
    setRightSidebarOpen(true)
    setRightSidebarTab("git")
  }

  const handleReview = openGitPanel
  const handleCommit = openGitPanel

  const handleDismiss = () => {
    dismissNudge(currentSessionId)
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--status-warning)]/30 bg-[var(--status-warning)]/5 px-3 py-1.5">
      <Icon name="error-warning" className="h-3.5 w-3.5 flex-shrink-0 text-[var(--status-warning)]" />
      <span className="min-w-0 flex-1 text-xs text-foreground">
        {t("chat.doneNotCommitted.message", { count: fileCount })}
      </span>
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleReview}>
        {t("chat.doneNotCommitted.review")}
      </Button>
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCommit}>
        {t("chat.doneNotCommitted.commit")}
      </Button>
      <button
        type="button"
        onClick={handleDismiss}
        className="flex-shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={t("chat.doneNotCommitted.dismiss")}
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})

DoneNotCommittedNudge.displayName = "DoneNotCommittedNudge"
