import React from "react"
import { AxCodeIcon } from "@/components/ui/AxCodeIcon"
import { useGlobalSyncStore } from "@/sync/global-sync-store"
import { useI18n } from "@/lib/i18n"
import { useUIStore } from "@/stores/useUIStore"
import { Icon } from "@/components/icon/Icon"
import { sessionEvents } from "@/lib/sessionEvents"

/**
 * Empty chat surface — intentionally sparse (Ma / negative space).
 * One focal mark, short hierarchy, and a single primary action so the
 * canvas can breathe without competing with the multi-pane shell.
 */
const ChatEmptyState: React.FC = () => {
  const { t } = useI18n()
  const initError = useGlobalSyncStore((s) => s.error)

  const handleOpenFolder = React.useCallback(() => {
    sessionEvents.requestDirectoryDialog()
  }, [])

  const handleShowShortcuts = React.useCallback(() => {
    useUIStore.getState().setHelpDialogOpen(true)
  }, [])

  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full px-6 py-16 sm:py-20">
      <div className="flex flex-col items-center gap-8 max-w-sm w-full">
        <AxCodeIcon width={56} height={56} className="opacity-[0.32] shrink-0" aria-hidden />
        {initError ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="typography-ui-header font-medium text-destructive">
              {t("chat.emptyState.axCodeUnreachable")}
            </span>
            <span className="typography-meta text-muted-foreground leading-relaxed">{initError.message}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-8 text-center w-full">
            <div className="flex flex-col items-center gap-2.5">
              <span className="typography-ui-header font-medium text-foreground tracking-tight">
                {t("chat.emptyState.startNewChat")}
              </span>
              <span className="typography-meta text-muted-foreground leading-relaxed max-w-[22rem]">
                {t("chat.emptyState.tagline")}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleOpenFolder}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-[var(--surface-elevated)] px-3.5 py-2 typography-meta font-medium text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
              >
                <Icon name="folder-add" className="h-3.5 w-3.5" />
                {t("emptyState.chat.openFolder")}
              </button>
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
        )}
      </div>
    </div>
  )
}

export default React.memo(ChatEmptyState)
