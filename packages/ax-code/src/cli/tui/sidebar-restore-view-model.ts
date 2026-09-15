// Restore chip for a collapsed session sidebar. Mirrors the navigation bar's
// "Sessions /navigation" entry: clickable chrome that reopens the panel.

export const SIDEBAR_PANEL_MIN_WIDTH = 120

export function sidebarRestoreVisible(input: {
  sessionRoute: boolean
  childSession: boolean
  sidebar: "auto" | "hide"
  terminalWidth: number
}): boolean {
  if (!input.sessionRoute || input.childSession) return false
  if (input.sidebar === "auto" && input.terminalWidth > SIDEBAR_PANEL_MIN_WIDTH) return false
  return true
}

export function sidebarRestoreEntry(width: number): string {
  return width >= 12 ? "/sidebar" : ""
}
