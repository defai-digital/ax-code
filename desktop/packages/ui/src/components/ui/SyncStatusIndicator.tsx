import React from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConfigStore } from "@/stores/useConfigStore"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type SyncStatus = "connected" | "reconnecting" | "connecting" | "disconnected"

function resolveSyncStatus(
  isConnected: boolean,
  connectionPhase: "connecting" | "connected" | "reconnecting",
  hasEverConnected: boolean,
): SyncStatus {
  if (isConnected && connectionPhase === "connected") {
    return "connected"
  }
  if (connectionPhase === "reconnecting") {
    return "reconnecting"
  }
  if (connectionPhase === "connecting" && !hasEverConnected) {
    return "connecting"
  }
  if (!isConnected && hasEverConnected) {
    return "disconnected"
  }
  return "connecting"
}

const statusConfig: Record<
  SyncStatus,
  { dotClass: string; pulse: boolean; labelKey: "syncStatus.connected" | "syncStatus.reconnecting" | "syncStatus.connecting" | "syncStatus.disconnected" }
> = {
  connected: {
    dotClass: "bg-status-success",
    pulse: false,
    labelKey: "syncStatus.connected",
  },
  reconnecting: {
    dotClass: "bg-status-warning",
    pulse: true,
    labelKey: "syncStatus.reconnecting",
  },
  connecting: {
    dotClass: "bg-muted-foreground/50",
    pulse: true,
    labelKey: "syncStatus.connecting",
  },
  disconnected: {
    dotClass: "bg-status-error",
    pulse: false,
    labelKey: "syncStatus.disconnected",
  },
}

export const SyncStatusIndicator: React.FC = React.memo(function SyncStatusIndicator() {
  const { t } = useI18n()
  const isConnected = useConfigStore((s) => s.isConnected)
  const connectionPhase = useConfigStore((s) => s.connectionPhase)
  const hasEverConnected = useConfigStore((s) => s.hasEverConnected)

  const status = resolveSyncStatus(isConnected, connectionPhase, hasEverConnected)
  const config = statusConfig[status]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="app-region-no-drag inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-interactive-hover transition-colors"
          aria-label={t(config.labelKey)}
        >
          <span className="relative flex h-2.5 w-2.5">
            {config.pulse && (
              <span
                className={cn(
                  "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                  config.dotClass,
                )}
              />
            )}
            <span
              className={cn(
                "relative inline-flex h-2.5 w-2.5 rounded-full",
                config.dotClass,
              )}
            />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{t(config.labelKey)}</p>
      </TooltipContent>
    </Tooltip>
  )
})
