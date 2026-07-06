import React from "react"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { useAttentionStore } from "@/stores/useAttentionStore"
import { isDesktopShell, isTauriShell } from "@/lib/desktop"
import { desktopHostsGet, locationMatchesHost, redactSensitiveUrl } from "@/lib/desktopHosts"
import { setDesktopWindowTitle } from "@/lib/desktopNative"

const APP_TITLE = "AX Code"

const formatProjectLabel = (label: string): string => {
  return label.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

const getProjectNameFromPath = (path: string): string => {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "")
  const segments = normalized.split("/").filter(Boolean)
  return segments[segments.length - 1] ?? ""
}

const buildWindowTitle = (projectLabel: string | null, instanceLabel: string | null): string => {
  const parts = [projectLabel, instanceLabel, APP_TITLE].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  )
  return parts.join(" | ")
}

export const resolveDesktopWindowInstanceLabel = ({
  currentHref,
  localOrigin,
  hosts,
}: {
  currentHref: string
  localOrigin?: string | null
  hosts: Array<{ label: string; url: string }>
}): string | null => {
  const knownLocalOrigin = typeof localOrigin === "string" && localOrigin.trim().length > 0 ? localOrigin : null
  if (knownLocalOrigin && locationMatchesHost(currentHref, knownLocalOrigin)) {
    return null
  }

  const match = hosts.find((host) => locationMatchesHost(currentHref, host.url))
  return match?.label?.trim() ? redactSensitiveUrl(match.label.trim()) : "Instance"
}

export const useWindowTitle = () => {
  const activeProject = useProjectsStore((state) => {
    if (!state.activeProjectId) {
      return null
    }
    return state.projects.find((project) => project.id === state.activeProjectId) ?? null
  })

  const projectLabel = React.useMemo(() => {
    if (!activeProject) {
      return null
    }

    const label = activeProject.label?.trim()
    if (label) {
      return formatProjectLabel(label)
    }

    const pathName = getProjectNameFromPath(activeProject.path)
    if (pathName) {
      return formatProjectLabel(pathName)
    }

    return null
  }, [activeProject])

  const [instanceLabel, setInstanceLabel] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (typeof window === "undefined" || !isDesktopShell()) {
      setInstanceLabel(null)
      return
    }

    let cancelled = false

    const refreshInstanceLabel = async () => {
      try {
        const currentHref = window.location.href
        const cfg = await desktopHostsGet()
        const nextLabel = resolveDesktopWindowInstanceLabel({
          currentHref,
          localOrigin: cfg.localOrigin || window.__AX_CODE_DESKTOP_LOCAL_ORIGIN__ || null,
          hosts: cfg.hosts,
        })
        if (!cancelled) {
          setInstanceLabel(nextLabel)
        }
      } catch {
        if (!cancelled) {
          setInstanceLabel("Instance")
        }
      }
    }

    void refreshInstanceLabel()

    const handleFocus = () => {
      void refreshInstanceLabel()
    }

    window.addEventListener("focus", handleFocus)
    return () => {
      cancelled = true
      window.removeEventListener("focus", handleFocus)
    }
  }, [])

  const pendingApprovalCount = useAttentionStore((state) => state.pendingApprovalCount)

  const title = React.useMemo(() => {
    const base = buildWindowTitle(projectLabel, instanceLabel)
    // Desktop shells surface the count via the dock/taskbar badge instead.
    if (pendingApprovalCount > 0 && !isDesktopShell()) {
      return `(${pendingApprovalCount}) ${base}`
    }
    return base
  }, [projectLabel, instanceLabel, pendingApprovalCount])

  React.useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = title
    }

    if (!isTauriShell()) {
      return
    }

    const applyTitle = async () => {
      try {
        const isMac = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent || "")
        if (isMac) {
          return
        }

        await setDesktopWindowTitle(title)
      } catch {
        return
      }
    }

    void applyTitle()
  }, [title])
}
