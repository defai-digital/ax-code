import React from "react"
import { AxCodeIcon } from "@/components/ui/AxCodeIcon"
import { useThemeSystem } from "@/contexts/useThemeSystem"
import { useGlobalSyncStore } from "@/sync/global-sync-store"
import { useI18n } from "@/lib/i18n"
import { useUIStore } from "@/stores/useUIStore"
import { Icon } from "@/components/icon/Icon"

const ChatEmptyState: React.FC = () => {
  const { t } = useI18n()
  const { currentTheme } = useThemeSystem()
  const initError = useGlobalSyncStore((s) => s.error)

  const textColor = currentTheme?.colors?.surface?.mutedForeground || "var(--muted-foreground)"

  const handleOpenCommandPalette = React.useCallback(() => {
    useUIStore.getState().setCommandPaletteOpen(true)
  }, [])

  const handleShowShortcuts = React.useCallback(() => {
    useUIStore.getState().setHelpDialogOpen(true)
  }, [])

  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full gap-6">
      <AxCodeIcon width={140} height={140} className="opacity-[0.13]" />
      {initError ? (
        <div className="flex flex-col items-center gap-2 max-w-md text-center px-4">
          <span className="text-body-md font-medium text-destructive">{t("chat.emptyState.axCodeUnreachable")}</span>
          <span className="text-body-sm" style={{ color: textColor }}>
            {initError.message}
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-body-md" style={{ color: textColor }}>
              {t("chat.emptyState.startNewChat")}
            </span>
            <span className="text-body-sm opacity-60" style={{ color: textColor }}>
              {t("chat.emptyState.tagline")}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={handleOpenCommandPalette}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground"
            >
              <Icon name="command" className="h-3.5 w-3.5" />
              {t("emptyState.chat.openFolder")}
            </button>
            <button
              type="button"
              onClick={handleShowShortcuts}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground"
            >
              <Icon name="command" className="h-3.5 w-3.5" />
              {t("emptyState.chat.shortcuts")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(ChatEmptyState)
