import React from "react"
import { finishConfigUpdate, getConfigUpdateSnapshot, subscribeConfigUpdate } from "@/lib/configUpdate"
import { AxCodeIcon } from "./AxCodeIcon"

const RESTART_OVERLAY_TIMEOUT_MS = 120_000

export const ConfigUpdateOverlay: React.FC = () => {
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
          <div className="text-sm font-semibold text-foreground">AX Code is restarting</div>
          <div className="text-sm text-muted-foreground">{message}</div>
          {timedOut ? (
            <div className="text-xs text-[var(--status-error)]">
              AX Code is taking longer than expected. Reload the app or dismiss this message and retry.
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              This can take a few minutes. AX Code will resume automatically.
            </div>
          )}
        </div>
        {timedOut ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground"
              onClick={() => finishConfigUpdate()}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
