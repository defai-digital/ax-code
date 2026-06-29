const DESKTOP_BROWSER_NEW_WINDOW_DISPOSITIONS = new Set(["new-window", "foreground-tab", "background-tab"])

type DesktopBrowserNewWindowFields = {
  url?: unknown
  disposition?: unknown
  detail?: unknown
}

export type DesktopBrowserNewWindowNavigation = {
  url: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

export const readDesktopBrowserNewWindowNavigation = (event: Event): DesktopBrowserNewWindowNavigation | null => {
  const fields = event as Event & DesktopBrowserNewWindowFields
  const detail = isRecord(fields.detail) ? fields.detail : null
  const disposition =
    typeof fields.disposition === "string"
      ? fields.disposition
      : typeof detail?.disposition === "string"
        ? detail.disposition
        : ""

  if (!DESKTOP_BROWSER_NEW_WINDOW_DISPOSITIONS.has(disposition)) {
    return null
  }

  const url = typeof fields.url === "string" ? fields.url : typeof detail?.url === "string" ? detail.url : ""
  return url ? { url } : null
}
