import React from "react"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon/Icon"
import { normalizeProjectPath } from "@/lib/projectResolution"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { useSessions } from "@/sync/sync-context"

type DashboardPanelProps = {
  directory: string
}

const getDesktopServerOrigin = (): string => {
  if (typeof window === "undefined") return ""

  return (
    window.__AX_CODE_DESKTOP_DESKTOP_SERVER__?.origin ||
    window.__AX_CODE_DESKTOP_LOCAL_ORIGIN__ ||
    window.location.origin
  )
}

const buildDashboardUrl = (sessionId: string | null, directory: string, origin: string): string => {
  const normalizedOrigin = origin.replace(/\/+$/, "")
  const withOrigin = (path: string): string => (normalizedOrigin ? `${normalizedOrigin}${path}` : path)

  const params = new URLSearchParams()
  if (directory) {
    params.set("directory", directory)
  }
  const query = params.toString()

  if (sessionId) {
    const sessionPath = `/dre-graph/session/${encodeURIComponent(sessionId)}`
    return withOrigin(query ? `${sessionPath}?${query}` : sessionPath)
  }

  return withOrigin(query ? `/dre-graph?${query}` : "/dre-graph")
}

const getSessionDirectory = (session: unknown): string => {
  const directory = (session as { directory?: unknown } | null)?.directory
  return typeof directory === "string" ? directory : ""
}

const isSameDirectory = (left: string, right: string): boolean => {
  const normalizedLeft = normalizeProjectPath(left)
  const normalizedRight = normalizeProjectPath(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

export const DashboardPanel: React.FC<DashboardPanelProps> = ({ directory }) => {
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId)
  const sessions = useSessions()
  const [reloadKey, setReloadKey] = React.useState(0)
  const dashboardOrigin = React.useMemo(() => getDesktopServerOrigin(), [])

  const currentSession = React.useMemo(() => {
    if (!currentSessionId) return null
    return sessions.find((session) => session.id === currentSessionId) ?? null
  }, [currentSessionId, sessions])

  const dashboardSession = React.useMemo(() => {
    if (!currentSession || !isSameDirectory(getSessionDirectory(currentSession), directory)) {
      return null
    }
    return currentSession
  }, [currentSession, directory])

  const dashboardUrl = React.useMemo(
    () => buildDashboardUrl(dashboardSession?.id ?? null, directory, dashboardOrigin),
    [dashboardSession?.id, directory, dashboardOrigin],
  )

  const title = dashboardSession?.title?.trim() || (dashboardSession ? "Session Dashboard" : "Project Dashboard")
  const subtitle = dashboardSession
    ? "Live DRE dashboard for the selected session."
    : "Select a session for detailed DRE evidence, or use the project dashboard index."

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6 text-center text-muted-foreground">
        Open a project to use Dashboard.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/40 bg-[var(--surface-background)] px-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icon name="bar-chart-box" className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate typography-ui-label">{title}</div>
            <div className="hidden truncate typography-micro text-muted-foreground sm:block">{subtitle}</div>
          </div>
        </div>
        <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={() => setReloadKey((key) => key + 1)}>
          <Icon name="refresh" className="h-3.5 w-3.5" />
          Refresh
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="gap-1"
          onClick={() => window.open(dashboardUrl, "_blank", "noopener,noreferrer")}
        >
          <Icon name="external-link" className="h-3.5 w-3.5" />
          Open
        </Button>
      </div>

      <div className="min-h-0 flex-1 bg-[var(--surface-background)]">
        <iframe
          key={`${dashboardUrl}:${reloadKey}`}
          src={dashboardUrl}
          title={title}
          className="h-full w-full border-0 bg-background"
          sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
        />
      </div>
    </div>
  )
}

export default DashboardPanel
