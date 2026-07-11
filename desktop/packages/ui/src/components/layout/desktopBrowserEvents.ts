import { isRecord } from "@/lib/record"

const DESKTOP_BROWSER_NEW_WINDOW_DISPOSITIONS = new Set(["new-window", "foreground-tab", "background-tab"])

type DesktopBrowserNewWindowFields = {
  url?: unknown
  disposition?: unknown
  detail?: unknown
}

export type DesktopBrowserNewWindowNavigation = {
  url: string
}

export type DesktopBrowserLoadUrl = (url: string) => void

type DesktopBrowserLoadFailureFields = {
  errorCode?: unknown
  errorDescription?: unknown
  validatedURL?: unknown
  isMainFrame?: unknown
  detail?: unknown
}

export type DesktopBrowserLoadFailure = {
  code: number
  description: string
  url: string
}

// Chromium reports ERR_ABORTED while a navigation is being replaced by a
// redirect or a newer navigation. Treating it as a page failure produces a
// false blank/error surface on otherwise healthy sites.
const CHROMIUM_ERR_ABORTED = -3

export const readDesktopBrowserLoadFailure = (event: Event): DesktopBrowserLoadFailure | null => {
  const fields = event as Event & DesktopBrowserLoadFailureFields
  const detail = isRecord(fields.detail) ? fields.detail : null
  const errorCode = typeof fields.errorCode === "number" ? fields.errorCode : detail?.errorCode
  const isMainFrame = typeof fields.isMainFrame === "boolean" ? fields.isMainFrame : detail?.isMainFrame

  if (typeof errorCode !== "number" || errorCode === 0 || errorCode === CHROMIUM_ERR_ABORTED || isMainFrame === false) {
    return null
  }

  const description =
    typeof fields.errorDescription === "string"
      ? fields.errorDescription
      : typeof detail?.errorDescription === "string"
        ? detail.errorDescription
        : ""
  const url =
    typeof fields.validatedURL === "string"
      ? fields.validatedURL
      : typeof detail?.validatedURL === "string"
        ? detail.validatedURL
        : ""

  return { code: errorCode, description, url }
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

export const handleDesktopBrowserNewWindowEvent = (event: Event, loadUrl: DesktopBrowserLoadUrl): boolean => {
  event.preventDefault()

  const navigation = readDesktopBrowserNewWindowNavigation(event)
  if (!navigation) {
    return false
  }

  loadUrl(navigation.url)
  return true
}
