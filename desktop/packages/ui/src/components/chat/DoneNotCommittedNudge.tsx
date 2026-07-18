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

/**
 * Post-turn "next steps" strip after an agent run ends.
 * Surfaces review/commit when the tree is dirty, plus conversation search always.
 */
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
  const setTimelineDialogOpen = useUIStore((s) => s.setTimelineDialogOpen)
  const runEndedAt = useSessionRunEndedAt(currentSessionId ?? "")
  const dismissedAt = useNudgeDismissedAt(currentSessionId ?? "")
  const dismissNudge = useRunStateStore((s) => s.dismissNudge)

  const isIdle = (sessionStatus?.type ?? "idle") === "idle" && permissions.length === 0
  const isDirty = isGitRepo === true && gitStatus !== null && !gitStatus.isClean
  const fileCount = gitStatus?.files?.length ?? 0

  // Show after an observed run-ended transition; stay dismissed until next run ends.
  const visible =
    Boolean(currentSessionId) &&
    runEndedAt !== null &&
    isIdle &&
    (dismissedAt === null || dismissedAt < runEndedAt)

  if (!visible || !currentSessionId) return null

  const openGitPanel = () => {
    setRightSidebarOpen(true)
    setRightSidebarTab("git")
  }

  const handleDismiss = () => {
    dismissNudge(currentSessionId)
  }

  const message =
    isDirty && fileCount > 0
      ? t("chat.turnNextSteps.messageDirty", { count: fileCount })
      : t("chat.turnNextSteps.messageIdle")

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-[var(--surface-elevated)] px-3 py-1.5">
      <Icon
        name={isDirty && fileCount > 0 ? "error-warning" : "checkbox-circle"}
        className={
          isDirty && fileCount > 0
            ? "h-3.5 w-3.5 flex-shrink-0 text-[var(--status-warning)]"
            : "h-3.5 w-3.5 flex-shrink-0 text-[var(--status-success)]"
        }
      />
      <span className="min-w-0 flex-1 typography-micro text-foreground">{message}</span>
      {isDirty && fileCount > 0 ? (
        <>
          <Button variant="ghost" size="sm" className="h-6 px-2 typography-micro" onClick={openGitPanel}>
            {t("chat.turnNextSteps.review")}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 typography-micro" onClick={openGitPanel}>
            {t("chat.turnNextSteps.commit")}
          </Button>
        </>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 typography-micro"
        onClick={() => setTimelineDialogOpen(true)}
      >
        {t("chat.turnNextSteps.search")}
      </Button>
      <button
        type="button"
        onClick={handleDismiss}
        className="flex-shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={t("chat.turnNextSteps.dismiss")}
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})

DoneNotCommittedNudge.displayName = "DoneNotCommittedNudge"
