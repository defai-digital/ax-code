import React from "react"
import { Icon } from "@/components/icon/Icon"
import { requestSyncRetryNow } from "@/sync/event-pipeline"
import { useConfigStore } from "@/stores/useConfigStore"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Grace period before the banner appears so short reconnect blips (transport
// switch, single fast retry) stay invisible. The pipeline retries quickly in
// a visible tab, so anything past this is a genuine outage the user should
// see — a frozen stream otherwise looks like a hung agent.
const RECONNECT_BANNER_DELAY_MS = 6_000

export const ReconnectBanner: React.FC = React.memo(function ReconnectBanner() {
  const { t } = useI18n()
  const connectionPhase = useConfigStore((s) => s.connectionPhase)
  const lastDisconnectReason = useConfigStore((s) => s.lastDisconnectReason)
  const isReconnecting = connectionPhase === "reconnecting"

  const [delayElapsed, setDelayElapsed] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(false)

  React.useEffect(() => {
    if (!isReconnecting) {
      // Reset so the next disconnect cycle can show the banner again.
      setDelayElapsed(false)
      setDismissed(false)
      return
    }
    const timer = setTimeout(() => setDelayElapsed(true), RECONNECT_BANNER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isReconnecting])

  if (!isReconnecting || !delayElapsed || dismissed) {
    return null
  }

  return (
    <div
      role="alert"
      className="app-region-no-drag flex items-center justify-center gap-2 border-t border-border/70 bg-[var(--surface-background)] px-4 py-1.5 typography-ui-label text-muted-foreground"
    >
      <Icon name="alert" className="h-3.5 w-3.5 shrink-0 text-status-warning" />
      <span className="min-w-0 truncate">
        {t("syncStatus.reconnectBanner.title")}
        {lastDisconnectReason ? <span className="text-muted-foreground/70"> ({lastDisconnectReason})</span> : null}
      </span>
      <button
        type="button"
        onClick={() => requestSyncRetryNow()}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
      >
        <Icon name="refresh" className="h-3 w-3" />
        {t("syncStatus.reconnectBanner.retry")}
      </button>
      <button
        type="button"
        aria-label={t("syncStatus.reconnectBanner.dismiss")}
        onClick={() => setDismissed(true)}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md p-1 transition-colors",
          "hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]",
        )}
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})
