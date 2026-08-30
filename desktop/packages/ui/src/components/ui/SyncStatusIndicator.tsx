import React from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConnectionStore, type ConnectionPhase } from "@/lib/event-stream/connection-state"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type SyncStatus = "connected" | "reconnecting" | "connecting"

function resolveSyncStatus(connectionPhase: ConnectionPhase): SyncStatus {
  if (connectionPhase === "connected") {
    return "connected"
  }
  // Under the connection-state store semantics (S4.7) "connecting" only ever
  // occurs before the first successful connect — markStreamDisconnected keeps
  // "connecting" solely while hasEverConnected is false. A dropped stream
  // after a successful connect is therefore always "reconnecting", which is
  // the accurate long-term state because the pipeline retries forever. The
  // old "disconnected" branch (connecting + hasEverConnected) could never
  // co-occur and was removed (S4 review).
  return connectionPhase === "reconnecting" ? "reconnecting" : "connecting"
}

const statusConfig: Record<
  SyncStatus,
  {
    dotClass: string
    pulse: boolean
    labelKey: "syncStatus.connected" | "syncStatus.reconnecting" | "syncStatus.connecting"
  }
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
}

export const SyncStatusIndicator: React.FC = React.memo(function SyncStatusIndicator() {
  const { t } = useI18n()
  const connectionPhase = useConnectionStore((s) => s.phase)

  const status = resolveSyncStatus(connectionPhase)
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
            <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", config.dotClass)} />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{t(config.labelKey)}</p>
      </TooltipContent>
    </Tooltip>
  )
})
