import React from "react"
import { finishConfigUpdate, getConfigUpdateSnapshot, subscribeConfigUpdate } from "@/lib/configUpdate"
import { useI18n } from "@/lib/i18n"
import { AxCodeIcon } from "./AxCodeIcon"

const RESTART_OVERLAY_TIMEOUT_MS = 120_000

export const ConfigUpdateOverlay: React.FC = () => {
  const { t } = useI18n()
  const [{ isUpdating, message }, setState] = React.useState(() => getConfigUpdateSnapshot())
  const [timedOut, setTimedOut] = React.useState(false)

  React.useEffect(() => {
    return subscribeConfigUpdate(setState)
  }, [])

  React.useEffect(() => {
    if (!isUpdating) {
      setTimedOut(false)
      return
    }
    const timer = window.setTimeout(() => setTimedOut(true), RESTART_OVERLAY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [isUpdating])

  if (!isUpdating) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/90 px-6"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <AxCodeIcon width={80} height={80} />
        <div className="space-y-1.5">
          <div className="typography-ui-label font-semibold text-foreground">{t("configUpdate.restarting")}</div>
          <div className="typography-ui-label text-muted-foreground">{message}</div>
          {timedOut ? (
            <div className="typography-meta text-[var(--status-error)]">{t("configUpdate.timeoutHint")}</div>
          ) : (
            <div className="typography-meta text-muted-foreground">{t("configUpdate.waitHint")}</div>
          )}
        </div>
        {timedOut ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 typography-ui-label font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
              onClick={() => window.location.reload()}
            >
              {t("configUpdate.reloadApp")}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 typography-ui-label font-medium text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
              onClick={() => finishConfigUpdate()}
            >
              {t("configUpdate.dismiss")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
