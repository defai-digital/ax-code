import type { useI18n } from "@/lib/i18n"
import type { ContextPanelMode } from "@/stores/useUIStore"

export type ContextPanelTranslateFn = ReturnType<typeof useI18n>["t"]

export const CONTEXT_PANEL_TAB_LABEL_MAX_CHARS = 24

export const normalizeContextPanelDirectoryKey = (value: string): string => {
  if (!value) return ""

  const raw = value.replace(/\\/g, "/")
  const hadUncPrefix = raw.startsWith("//")
  let normalized = raw.replace(/\/+$/g, "")
  normalized = normalized.replace(/\/+/g, "/")

  if (hadUncPrefix && !normalized.startsWith("//")) {
    normalized = `/${normalized}`
  }

  if (normalized === "") {
    return raw.startsWith("/") ? "/" : ""
  }

  return normalized
}

export const getContextPanelModeLabel = (mode: ContextPanelMode, t: ContextPanelTranslateFn): string => {
  if (mode === "chat") return t("contextPanel.mode.chat")
  if (mode === "file") return t("contextPanel.mode.files")
  if (mode === "diff") return t("contextPanel.mode.diff")
  if (mode === "plan") return t("contextPanel.mode.plan")
  if (mode === "preview") return t("contextPanel.mode.preview")
  if (mode === "browser") return t("contextPanel.mode.browser")
  if (mode === "dashboard") return "Dashboard"
  return t("contextPanel.mode.context")
}

export const getContextPanelFileNameFromPath = (path: string | null): string | null => {
  if (!path) {
    return null
  }

  const normalized = path.replace(/\\/g, "/").trim()
  if (!normalized) {
    return null
  }

  const segments = normalized.split("/").filter(Boolean)
  if (segments.length === 0) {
    return normalized
  }

  return segments[segments.length - 1] || null
}

export const getContextPanelTabLabel = (
  tab: { mode: ContextPanelMode; label: string | null; targetPath: string | null; stagedDiff?: boolean },
  t: ContextPanelTranslateFn,
): string => {
  if (tab.label) {
    return tab.label
  }

  if (tab.mode === "file") {
    return getContextPanelFileNameFromPath(tab.targetPath) || t("contextPanel.mode.files")
  }

  if (tab.mode === "preview") {
    const url = tab.targetPath
    if (url) {
      try {
        const parsed = new URL(url)
        return parsed.host || parsed.hostname || t("contextPanel.mode.preview")
      } catch {
        // ignore invalid URL
      }
    }
    return t("contextPanel.mode.preview")
  }

  if (tab.mode === "diff") {
    return tab.stagedDiff ? t("contextPanel.mode.stagedDiff") : t("contextPanel.mode.workingDiff")
  }

  return getContextPanelModeLabel(tab.mode, t)
}

export const truncateContextPanelTabLabel = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars - 3)}...`
}

export const getContextPanelSessionIDFromDedupeKey = (dedupeKey: string | undefined): string | null => {
  if (!dedupeKey || !dedupeKey.startsWith("session:")) {
    return null
  }

  const sessionID = dedupeKey.slice("session:".length).trim()
  return sessionID || null
}
