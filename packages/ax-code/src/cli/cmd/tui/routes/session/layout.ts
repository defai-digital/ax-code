// Shared session layout math used by the main pane, header, sidebar, and prompt.
// Keep this isolated from component modules so width calculations stay testable
// and low-dependency.

import { CHROME_WIDTH_DEFAULT, chromeWidth } from "../../chrome-width"

const SIDEBAR_MAIN_MIN_WIDTH = 80

export function computeSidebarWidth(terminalWidth: number, preferred: unknown = CHROME_WIDTH_DEFAULT): number {
  const wanted = chromeWidth(preferred)
  if (terminalWidth <= 120) return Math.min(wanted, Math.max(0, terminalWidth))
  return Math.min(wanted, Math.max(0, terminalWidth - 4 - SIDEBAR_MAIN_MIN_WIDTH))
}

export function computeSessionMainPaneWidth(input: {
  terminalWidth: number
  sidebarVisible: boolean
  gutter?: number
  sidebarPreferredWidth?: unknown
}) {
  const gutter = input.gutter ?? 4
  return Math.max(
    0,
    input.terminalWidth -
      gutter -
      (input.sidebarVisible ? computeSidebarWidth(input.terminalWidth, input.sidebarPreferredWidth) : 0),
  )
}
