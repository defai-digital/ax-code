import React from "react"
import { AxCodeIcon } from "@/components/ui/AxCodeIcon"
import { useGlobalSyncStore } from "@/sync/global-sync-store"
import { useI18n } from "@/lib/i18n"
import { useUIStore } from "@/stores/useUIStore"
import { Icon } from "@/components/icon/Icon"

const ChatEmptyState: React.FC = () => {
  const { t } = useI18n()
  const initError = useGlobalSyncStore((s) => s.error)

  const handleOpenCommandPalette = React.useCallback(() => {
    useUIStore.getState().setCommandPaletteOpen(true)
  }, [])

  const handleShowShortcuts = React.useCallback(() => {
    useUIStore.getState().setHelpDialogOpen(true)
  }, [])

  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full gap-4">
      <AxCodeIcon width={72} height={72} className="opacity-45" />
      {initError ? (
        <div className="flex flex-col items-center gap-2 max-w-md text-center px-4">
          <span className="typography-ui-header font-medium text-destructive">
            {t("chat.emptyState.axCodeUnreachable")}
          </span>
          <span className="typography-meta text-muted-foreground">{initError.message}</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <span className="typography-ui-header font-medium text-foreground">
              {t("chat.emptyState.startNewChat")}
            </span>
            <span className="typography-meta text-muted-foreground">{t("chat.emptyState.tagline")}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={handleOpenCommandPalette}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-[var(--surface-elevated)] px-3 py-1.5 typography-meta font-medium text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
            >
              <Icon name="folder-add" className="h-3.5 w-3.5" />
              {t("emptyState.chat.openFolder")}
            </button>
            <button
              type="button"
              onClick={handleShowShortcuts}
              className="inline-flex items-center gap-1.5 rounded-md border border-transparent bg-transparent px-3 py-1.5 typography-meta font-medium text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
            >
              <Icon name="question" className="h-3.5 w-3.5" />
              {t("emptyState.chat.shortcuts")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(ChatEmptyState)
