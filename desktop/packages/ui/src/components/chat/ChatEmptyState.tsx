import React from "react"
import { AxCodeIcon } from "@/components/ui/AxCodeIcon"
import { useGlobalSyncStore } from "@/sync/global-sync-store"
import { useI18n } from "@/lib/i18n"
import { useUIStore } from "@/stores/useUIStore"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { Icon } from "@/components/icon/Icon"
import { ProjectsHome } from "@/components/projects/ProjectsHome"

/**
 * Empty chat surface — project-first when workspaces exist (Codex-style home),
 * sparse welcome when there is nothing to open yet.
 */
const ChatEmptyState: React.FC = () => {
  const { t } = useI18n()
  const initError = useGlobalSyncStore((s) => s.error)
  const projects = useProjectsStore((s) => s.projects)
  const setActiveMainTab = useUIStore((s) => s.setActiveMainTab)
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft)

  const handleShowShortcuts = React.useCallback(() => {
    useUIStore.getState().setHelpDialogOpen(true)
  }, [])

  const handleOpenProject = React.useCallback(() => {
    setActiveMainTab("chat")
    openNewSessionDraft()
  }, [openNewSessionDraft, setActiveMainTab])

  const handleNewSession = React.useCallback(
    (projectId: string) => {
      setActiveMainTab("chat")
      const project = useProjectsStore.getState().projects.find((entry) => entry.id === projectId)
      openNewSessionDraft({ directoryOverride: project?.path ?? null })
    },
    [openNewSessionDraft, setActiveMainTab],
  )

  if (initError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-full w-full px-6 py-16 sm:py-20">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <AxCodeIcon width={56} height={56} className="opacity-[0.32] shrink-0" aria-hidden />
          <span className="typography-ui-header font-medium text-destructive">
            {t("chat.emptyState.axCodeUnreachable")}
          </span>
          <span className="typography-meta text-muted-foreground leading-relaxed">{initError.message}</span>
        </div>
      </div>
    )
  }

  if (projects.length > 0) {
    return (
      <div className="flex min-h-full w-full justify-center px-6 py-10 sm:py-14">
        <div className="w-full max-w-2xl">
          <ProjectsHome onOpenProject={handleOpenProject} onNewSession={handleNewSession} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full px-6 py-16 sm:py-20">
      <div className="flex flex-col items-center gap-8 max-w-md w-full">
        <AxCodeIcon width={56} height={56} className="opacity-[0.32] shrink-0" aria-hidden />
        <div className="flex flex-col items-center gap-2.5 text-center">
          <span className="typography-ui-header font-medium text-foreground tracking-tight">
            {t("chat.emptyState.startNewChat")}
          </span>
          <span className="typography-meta text-muted-foreground leading-relaxed max-w-[22rem]">
            {t("chat.emptyState.tagline")}
          </span>
        </div>
        <ProjectsHome />
        <button
          type="button"
          onClick={handleShowShortcuts}
          className="inline-flex items-center gap-1.5 rounded-md border border-transparent bg-transparent px-3.5 py-2 typography-meta font-medium text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
        >
          <Icon name="question" className="h-3.5 w-3.5" />
          {t("emptyState.chat.shortcuts")}
        </button>
      </div>
    </div>
  )
}

export default React.memo(ChatEmptyState)
